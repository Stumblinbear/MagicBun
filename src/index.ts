import * as fs from 'async-file';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as https from 'https';

import Telegraf, { Context, Telegram } from 'telegraf';
import * as tt from 'telegraf/typings/telegram-types.d';

import * as acapelabox from './acapelabox';

const byebyte = require('byebyte');

const DEVELOPER = 104504591;

// One week marks the group as dead.
const ALIVE_CUTOFF = 1000 * 60 * 60 * 24 * 7;

const EXT_PHOTO = ['jpg', 'jpeg', 'png'];
const EXT_VIDEO = ['gif', 'mp4'];

const MOSH_INTENSITY: { [key: string]: number } = {
    mosh: 50,
    corrupt: 100,
    fuck: 200
};

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
    lastMessage: number;

    isSafe: boolean = false;

    constructor(data: any) {
        this.id = data.id;
        this.type = data.type;
        this.name = data.name || data.title || (data.first_name + ' ' + data.last_name).trim();
        this.username = data.username;
        this.lastMessage = data.lastMessage || Date.now();

        this.update(data);
    }

    receivedMessage() {
        this.lastMessage = Date.now();
    }

    update(data: any) {
        this.type = data.type;
        this.name = data.name || data.title || (data.first_name + ' ' + data.last_name).trim();
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

function download(url: string, dest: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        var file = fs.createWriteStream(dest);

        https.get(url, response => {
            response.pipe(file);

            file.on('finish', function() {
                file.close();

                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest);

            reject(err.message);
        });
    });
}

function t(ctx: Context, text: string, extra?: any) {
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

const bot = new Telegraf(process.env.BOT_TOKEN as string);

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

bot.on('message', (ctx, next) => {
    database.getChat(ctx.chat).receivedMessage();

    if(next) next();
});

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

bot.start(async ctx => { await ctx.reply(t(ctx, 'start')); await ctx.reply(t(ctx, 'help')); });
bot.help(async ctx => await ctx.reply(t(ctx, 'help')));

bot.command('stats', ctx => {
    ctx.reply(t(ctx, 'stats', {
        allUsers: database.allUsers,

        allGroups: database.allGroups,
        aliveGroups: database.aliveGroups,
        deadGroups: database.deadGroups
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

const ROLL_REGEX = /^bun,? roll ([0-9]{1,2})d([0-9]{1,5})$/i;
bot.hears(ROLL_REGEX, async ctx => {
    if(!ctx.message?.text) return;

    const [_, amt, die]: any = ROLL_REGEX.exec(ctx.message.text);

    if(amt <= 0) {
        await ctx.reply(t(ctx, 'roll_dice_fail'));
    }else{
        const all = [];
        for(let i = 0; i < amt; i++)
            all.push(Math.floor(Math.random() * die) + 1);

        if(amt == 1) {
            await ctx.reply(t(ctx, 'roll_die', {
                amt, die, result: all.reduce((acc, v) => acc + v, 0)
            }));
        }else{
            await ctx.reply(t(ctx, 'roll_dice', {
                all: '[' + all.join(', ') + ']', amt, die, sum: all.reduce((acc, v) => acc + v, 0)
            }));
        }
    }
});

bot.hears(new RegExp('^(' + Object.keys(MOSH_INTENSITY).join('|') + ')$', 'i'), async ctx => {
    if(!ctx.message?.text || !ctx.message?.reply_to_message) return;

    // let operation: string = ctx.message.text.indexOf(' ') !== -1 ? ctx.message.text.split(' ')[0] : 'destroy';
    let times = MOSH_INTENSITY[ctx.message.text.indexOf(' ') !== -1 ? ctx.message.text.split(' ')[1] : ctx.message.text];

    let file_id: string;
    let file_type: 'video' | 'photo';

    if(ctx.message.reply_to_message.video?.file_id) {
        file_id = ctx.message.reply_to_message.video?.file_id;
        file_type = 'video';
    }else if(ctx.message.reply_to_message.document?.mime_type == 'video/mp4') {
        file_id = ctx.message.reply_to_message.document?.file_id;
        file_type = 'video';
    }else if(ctx.message.reply_to_message.photo) {
        file_id = ctx.message.reply_to_message.photo[ctx.message.reply_to_message.photo.length - 1].file_id;
        file_type = 'photo';
    }else{
        return;
    }
    
    let tempFolder = path.resolve('../', 'temp');

    if(!await fs.exists(tempFolder))
        await fs.mkdir(tempFolder);

    let tempFile = path.resolve(tempFolder, file_id + '.' + (file_type == 'video' ? 'mp4' : 'png'));

    await ctx.replyWithChatAction(file_type == 'video' ? 'record_video' : 'upload_photo');

    if(!await fs.exists(tempFile))
        await download(await bot.telegram.getFileLink(file_id), tempFile);

    await ctx.replyWithChatAction(file_type == 'video' ? 'record_video' : 'upload_photo');

    let tempMoshedFile = path.resolve(tempFolder, file_id + '-moshed.' + (file_type == 'video' ? 'mp4' : 'png'));

    try {
        // let buf;
        
        // if(operation == 'destroy') {
        let buf = byebyte.destroy({
            fileBuffer: await fs.readFile(tempFile),
            len: (await fs.stat(tempFile)).size,

            min: 0,
            max: 1,
            times
        });
        /*}else{
            buf = byebyte.shuffle(await fs.readFile(tempFile), {
                min: 0,
                max: 1,

                chunkMin: 1,
                chunkMax: 2,
                times: 1
            });
        }*/

        await ctx.replyWithChatAction(file_type == 'video' ? 'upload_video' : 'upload_photo');

        if(file_type == 'video') {
            await ctx.replyWithVideo({ source: buf });
        }else{
            await ctx.replyWithPhoto({ source: buf });
        }
    } catch(e) {
        console.error(e);
    }
});

bot.command('voices', ctx => {
    ctx.reply(Object.keys(acapelabox.voices).join(', '));
});

const ACAPELA_REGEX = new RegExp('^(' + Object.keys(acapelabox.voices).join('|') + '),? ?say (.*)', 'i');

bot.hears(ACAPELA_REGEX, async ctx => {
    if(!ctx.message?.text) return;

    let [_, voiceId, text]: any = ACAPELA_REGEX.exec(ctx.message.text);

    voiceId = voiceId.toLowerCase();
    text = text.split('\n').join('..');

    await ctx.replyWithChatAction('record_audio');

    let url = await acapelabox.makeVoice(acapelabox.voices[voiceId], text);

    await ctx.replyWithChatAction('upload_audio');

    await ctx.replyWithVoice({ url, filename: voiceId + '.mp3' });
});

(() => {
    const listeners: { re: RegExp, response: any }[] = [];

    for(let [match, response] of Object.entries(JSON.parse(readFileSync(path.resolve('../', 'assets', 'listen.json'), { encoding: 'utf8' })))) {
        listeners.push({
            re: new RegExp(match.substring(1, match.lastIndexOf('/')), match.substring(match.lastIndexOf('/') + 1)),
            response
        });
    }

    bot.use(async (ctx, next) => {
        if(ctx.message && ctx.message.text) {
            for(let listener of listeners) {
                if(listener.re.test(ctx.message.text)) {
                    const response = listener.response;

                    // If the chance fails, continue searching.
                    if(response.chance && Math.random() > response.chance)
                        continue;

                    if(response.file) {
                        await ctx.replyWithChatAction('upload_photo');

                        let file: string;

                        // If it's a directory
                        if(response.file.indexOf('.') === -1) {
                            const files = await fs.readdir(path.resolve('../assets/', response.file));

                            file = path.resolve('../assets/', response.file, files[Math.floor(Math.random() * files.length)]);
                        }else{
                            file = path.resolve('../assets/', response.file);
                        }
                        
                        let ext = path.extname(file).substring(1);

                        if(EXT_PHOTO.includes(ext)) {
                            await ctx.replyWithPhoto({ source: file }, {
                                caption: response.text ? t(ctx, response.text) : undefined
                            });
                        }else if(EXT_VIDEO.includes(ext)) {
                            await ctx.replyWithVideo({ source: file }, {
                                caption: response.text ? t(ctx, response.text) : undefined
                            });
                        }else{
                            await ctx.replyWithDocument({ source: file }, {
                                caption: response.text ? t(ctx, response.text) : undefined
                            });
                        }
                    }else{
                        await ctx.reply(t(ctx, response.text));
                    }

                    // If a listener matches, bail. We don't want anything else to run.
                    return;
                }
            }
        }

        if(next) await next();
    });
})();

console.log('Starting bot...');

bot.launch();