import * as fs from 'async-file';
import * as path from 'path';
import * as https from 'https';

import { ContextMessageUpdate } from "telegraf";

import * as acapelabox from './acapelabox';

import { bot, t } from './index';

import { Random, MersenneTwister19937 } from 'random-js';

const random = new Random(MersenneTwister19937.autoSeed());

const byebyte = require('byebyte');

const EXT_PHOTO = ['jpg', 'jpeg', 'png'];
const EXT_VIDEO = ['gif', 'mp4'];

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

export async function respond(ctx: ContextMessageUpdate, match: RegExpExecArray, data: any) {
    // If the chance fails, continue searching.
    if(data.chance && !random.bool(data.chance))
        return false;

    if(data.file) {
        await ctx.replyWithChatAction('upload_photo');

        let file: string;

        // If it's a directory
        if(data.file.indexOf('.') === -1) {
            const files = await fs.readdir(path.resolve('../assets/', data.file));

            file = path.resolve('../assets/', data.file, files[random.integer(0, files.length - 1)]);
        }else{
            file = path.resolve('../assets/', data.file);
        }
        
        let ext = path.extname(file).substring(1);

        if(EXT_PHOTO.includes(ext)) {
            await ctx.replyWithPhoto({ source: file }, {
                reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined,
                caption: data.text ? t(ctx, data.text, match.groups) : undefined
            });
        }else if(EXT_VIDEO.includes(ext)) {
            await ctx.replyWithVideo({ source: file }, {
                reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined,
                caption: data.text ? t(ctx, data.text, match.groups) : undefined
            });
        }else{
            await ctx.replyWithDocument({ source: file }, {
                reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined,
                caption: data.text ? t(ctx, data.text, match.groups) : undefined
            });
        }
    }else{
        await ctx.reply(t(ctx, data.text, match.groups), {
            reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined,
        });
    }
    
    return true;
}

export async function roll(ctx: ContextMessageUpdate, match: RegExpExecArray, level: number) {
    const { amt, die }: any = match.groups;

    if(amt <= 0) {
        await ctx.reply(t(ctx, 'roll_dice_fail'), {
            reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined
        });
    }else{
        const all = [];
        for(let i = 0; i < amt; i++)
            all.push(random.integer(1, die));

        if(amt == 1) {
            await ctx.reply(t(ctx, 'roll_die', {
                amt, die, result: all.reduce((acc, v) => acc + v, 0)
            }), {
                reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined
            });
        }else{
            await ctx.reply(t(ctx, 'roll_dice', {
                all: '[' + all.join(', ') + ']', amt, die, sum: all.reduce((acc, v) => acc + v, 0)
            }), {
                reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined
            });
        }
    }
}

export async function mosh(ctx: ContextMessageUpdate, match: RegExpExecArray, level: number) {
    if(!ctx.message?.text || !ctx.message?.reply_to_message) return;

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

    try {
        // let buf;
        
        // if(operation == 'destroy') {
        let buf = byebyte.destroy({
            fileBuffer: await fs.readFile(tempFile),
            len: (await fs.stat(tempFile)).size,

            min: 0,
            max: 1,
            times: level * 50
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
            await ctx.replyWithVideo({ source: buf }, {
                reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined
            });
        }else{
            await ctx.replyWithPhoto({ source: buf }, {
                reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined
            });
        }
    } catch(e) {
        console.error(e);
        
        await ctx.reply(t(ctx, 'error'), {
            reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined
        });
    }
}

export async function acapela(ctx: ContextMessageUpdate, match: RegExpExecArray) {
    let { voice, text }: any = match.groups;

    voice = voice.toLowerCase();
    if(!acapelabox.voices[voice]) return false;

    text = text.split('\n').join('..');

    await ctx.replyWithChatAction('record_audio');

    let url = await acapelabox.makeVoice(acapelabox.voices[voice], text);

    await ctx.replyWithChatAction('upload_audio');

    await ctx.replyWithVoice({ url, filename: voice + '.mp3' }, {
        reply_to_message_id: ctx.chat?.type != 'private' ? ctx.message?.message_id : undefined
    });

    return true;
}