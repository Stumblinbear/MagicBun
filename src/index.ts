import * as fs from 'async-file';
import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';

import Telegraf, { Context, ContextMessageUpdate } from 'telegraf';
import * as tt from 'telegraf/typings/telegram-types.d';

import * as acapelabox from './acapelabox';

import * as intents from './intents';

const DEVELOPER = 104504591;

// Three days marks the group as dead.
const ALIVE_CUTOFF = 1000 * 60 * 60 * 24 * 3;

class Database {
    chats: { [key: number]: Chat } = { };

    constructor() {
        let database: any = {
            chats: []
        };

        try {
            database = JSON.parse(readFileSync(path.resolve('../', 'database.json'), { encoding: 'utf8' }));
        } catch(e) { console.log('Database doesn\'t exist. Creating.'); }

        for(let data of database.chats) {
            this.chats[data.id] = new Chat(data);
        }

        // Save every ten seconds
        setInterval(() => {
            this.save();
        }, 10000);
    }

    getChat(chat: tt.Chat | undefined): Chat {
        if(!chat) throw new Error('Chat cannot be null');

        if(!this.chats[chat.id])
            this.chats[chat.id] = new Chat(chat);
        else
            this.chats[chat.id].update(chat);

        return this.chats[chat.id];
    }

    get allUsers(): number {
        return Object.values(this.chats).filter(chat => !chat.isGroup).length;
    }

    get allGroups(): number {
        return Object.values(this.chats).filter(chat => chat.isGroup).length;
    }

    get aliveGroups(): number {
        return Object.values(this.chats).filter(chat => chat.isGroup && chat.lastMessage + ALIVE_CUTOFF > Date.now()).length;
    }

    get deadGroups(): number {
        return Object.values(this.chats).filter(chat => chat.isGroup && chat.lastMessage + ALIVE_CUTOFF <= Date.now()).length;
    }

    private countLanguages(isGroup: boolean): { [lang: string]: number } {
        let languages: { [lang: string]: number } = { };
        let total = 0;

        Object.values(this.chats).filter(chat => chat.isGroup == isGroup).forEach(chat => {
            for(const [lang, count] of Object.entries(chat.languages)) {
                if(!languages[lang])languages[lang] = 0;

                languages[lang] += count;
                total += count;
            }
        }, { });

        for(const lang of Object.keys(languages))
            languages[lang] = Math.round((languages[lang] / total) * 10000) / 100;

        return languages;
    }

    get privateLanguages(): { [lang: string]: number } { return this.countLanguages(false); }

    get groupLanguages(): { [lang: string]: number } { return this.countLanguages(true); }

    async save() {
        await fs.writeFile('../database.json', JSON.stringify({
            chats: Object.values(this.chats)
        }, null, 2), { encoding: 'utf8' });
    }
}

class Chat {
    id: number;
    type: string;
    name: string;
    username: string;

    isSafe: boolean = false;

    // Never store unconsenting user information or chat logs. Instead, we
    // just count up the language of messages sent to get a general idea for
    // who's using the bot, so languages for translation can be targetted
    languages: { [lang: string]: number };

    // This will give an idea of when the bot was added to the chat
    // vs approximately when they got removed (or the chat died)
    firstMessage: number;
    lastMessage: number;

    constructor(data: any) {
        this.id = data.id;
        this.type = data.type;
        this.name = data.name || data.title || (data.first_name + ' ' + (data.last_name || '')).trim();
        this.username = data.username;
        
        this.languages = data.languages || { };
        this.firstMessage = data.firstMessage || Date.now();
        this.lastMessage = data.lastMessage || Date.now();

        this.update(data);
    }

    receivedMessage(ctx: ContextMessageUpdate) {
        const lang = ctx.from?.language_code || 'unknown';

        if(lang) {
            if(!this.languages[lang])
                this.languages[lang] = 0;
            this.languages[lang]++;
        }

        this.lastMessage = Date.now();
    }

    update(data: any) {
        this.type = data.type;
        this.name = data.name || data.title || (data.first_name + ' ' + (data.last_name || '')).trim();
        this.username = data.username;
    }

    get isGroup() {
        return this.type !== 'private';
    }

    async isAdmin(user: tt.User | undefined) {
        if(!user) return false;

        // Stumblinbear is always admin
        if(user.id === DEVELOPER) return true;
        
        // If the admin is allowed to change group info
        return (await bot.telegram.getChatAdministrators(this.id))
                .filter(member => member.user.id == user.id && member.can_change_info);
    }
}

export function t(ctx: Context, text: string, extra?: any) {
    const chat = database.getChat(ctx.chat);
    const i18n = (ctx as any).i18n;

    let template: any;

    for(let lang of [i18n.languageCode, i18n.shortLanguageCode, i18n.config.defaultLanguageOnMissing]) {
        // Try and get a safe variant template, or, failing that, a template that doesn't care
        template = i18n.getTemplate(lang, text + '.' + (chat.isSafe ? 'safe' : 'unsafe')) || i18n.getTemplate(i18n.languageCode, text);

        // If a template is found, break from the loop
        if(!!template) break;
    }

    // If we found a template, use it
    if(template) {
        if(Array.isArray(template))
            template = template[Math.floor(Math.random() * template.length)];
        text = template(extra || { });
    }

    return text;
}

console.log('Loading database...');

const database = new Database();

export const bot = new Telegraf(process.env.BOT_TOKEN as string);

const i18n = new (require('telegraf-i18n'))({
    defaultLanguage: 'en',
    defaultLanguageOnMissing: 'en',
    directory: path.resolve('../', 'assets', 'locales')
});

bot.use(i18n.middleware());

bot.use(async (ctx, next) => {
    const reply = ctx.reply;

    ctx.reply = (text: string, extra?: tt.ExtraReplyMessage): Promise<tt.Message> => {
        return reply(text, {
            parse_mode: 'Markdown',
            ...extra
        });
    };

    try {
        if(next)
            await next();
    } catch(e) {
        await ctx.reply(t(ctx, 'error'));

        console.error(e);

        if(ctx.message) {
            await bot.telegram.sendMessage(DEVELOPER, e + '\n\n```\n' + JSON.stringify(ctx.message) + '```', {
                parse_mode: 'Markdown'
            });
        }else{
            await bot.telegram.sendMessage(DEVELOPER, e + '\n\nDid not occur due to a message.', {
                parse_mode: 'Markdown'
            });
        }
    }
});


// Inline query
const TRASH_REPLACE = [['&#39;', ''], ['\bi\b', 'i\'s'], ['\bjust\b', 'jus'], ['it is', 'tis'], ['\bis\b', 'ish'], ['\bit\'?s\b', 'is'], ['lol', 'hehe'], ['because', 'cuz'], ['fuck', 'FUCK'], ['l', 'w'], ['r', 'w'], ['okay', 'otay'], ['this', 'dis'], ['ce(?=\w)', 'ec'], ['ev', 'eb'], ['th', 'f'], ['so', 'sho']];
const TRASH_ENDINGS = [' >w<;', ' >w<', ' owo;', ' owo', ' uwu;', ' uwu', ' =w=', ' @////@', ' ono', ' nyaa~~', ', daddy', ' vnv', ' vwv', ' p~p', ' o~o', '~~'];

bot.on('inline_query', async ctx => {
    if(!ctx.inlineQuery?.query) return;

    let text: string = ctx.inlineQuery.query;

    text = text.toLowerCase().replace('[^a-zA-Z0-9\?,\n]', '')
    
    for(let trash of TRASH_REPLACE)
        text = text.replace(new RegExp(trash[0], 'g'), trash[1]);
    
    text = text + TRASH_ENDINGS[Math.floor(Math.random() * TRASH_ENDINGS.length)];

    await ctx.answerInlineQuery([
        { type: 'article', id: 'hewwo', title: 'Hewwo >w<;', description: text, input_message_content: { message_text: text } }
    ], { cache_time: 0 });
});


// Message handlers

bot.on('message', (ctx, next) => {
    database.getChat(ctx.chat).receivedMessage(ctx);

    if(next) next();
});

bot.start(async ctx => { await ctx.reply(t(ctx, 'start')); await ctx.reply(t(ctx, 'help')); });
bot.help(async ctx => await ctx.reply(t(ctx, 'help')));

bot.command('stats', ctx => {
    ctx.reply(t(ctx, 'stats', {
        users: {
            all: database.allUsers,
            languages: database.privateLanguages
        },

        groups: {
            all: database.allGroups,
            alive: database.aliveGroups,
            dead: database.deadGroups,
            languages: database.groupLanguages
        }
    }));
});

bot.command('snowflake_filter', async ctx => {
    const chat = database.getChat(ctx.chat);

    if(!chat.isAdmin(ctx.from)) {
        await ctx.reply(t(ctx, 'admin.prevent'));
    }else{
        chat.isSafe = !chat.isSafe;

        await ctx.reply(t(ctx, 'snowflake.' + (chat.isSafe ? 'enabled' : 'disabled')));
    }
});

bot.command('voices', ctx => {
    ctx.reply(Object.keys(acapelabox.voices).join(', '));
});


// Listener handlers

const listeners: { languageCode: string, re: RegExp, response: any }[] = [];

for(let file of readdirSync(path.resolve('../', 'assets', 'locales'))) {
    if(!file.endsWith('-triggers.json')) continue;

    let languageCode = path.basename(file).split('-triggers.json')[0];

    console.log('Loading', languageCode, 'triggers...')

    for(let [match, response] of Object.entries(JSON.parse(readFileSync(path.resolve('../', 'assets', 'locales', file), { encoding: 'utf8' })))) {
        listeners.push({
            languageCode,
            re: new RegExp(match.substring(1, match.lastIndexOf('/')), match.substring(match.lastIndexOf('/') + 1)),
            response
        });
    }
}

bot.use(async (ctx, next) => {
    if(ctx.message && ctx.message.text) {
        for(let listener of listeners) {
            if(listener.re.test(ctx.message.text)) {
                let id;
                let data;

                if(Array.isArray(listener.response)) {
                    id = listener.response[0];

                    if(listener.response.length > 1)
                        data = listener.response[1];
                }else if(typeof listener.response === 'object') {
                    id = listener.response.intent;
                    data = listener.response.data;
                }else{
                    id = listener.response;
                }

                const oldLocale = (ctx as any).i18n.locale();

                (ctx as any).i18n.locale(listener.languageCode);

                let result = await (intents as any)[id](ctx, listener.re.exec(ctx.message.text), data);

                (ctx as any).i18n.locale(oldLocale);

                if(result === false) continue;

                // If a listener matches, bail. We don't want anything else to run.
                return;
            }
        }
    }

    if(next) await next();
});


// Boooooot

console.log('Starting bot...');

bot.launch();