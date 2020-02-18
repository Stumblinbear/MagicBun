import * as request from 'request';

const ACAPELABOX_URL = 'https://acapela-box.com/AcaBox';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:73.0) Gecko/20100101 Firefox/73.0'
};

const session = request.defaults({ jar: true });

function login() {
    return new Promise((resolve, reject) => {
        console.log('Logging in to AcapelaBox (', process.env.AC_USER, '/', process.env.AC_PASS, ')...');
    
        session.post(ACAPELABOX_URL + '/login.php', {
            form: {
                login: process.env.AC_USER,
                password: process.env.AC_PASS
            }, headers: HEADERS
        }, (err, res, body) => {
            if(err) { reject(err); return; }

            if(res.statusCode != 200) {
                reject();
                return;
            }

            resolve();
        });
    });
}

export function makeVoice(voiceId: string, text: string, rate: number = 0, shaping: number = 0, triedAgain: boolean = false): Promise<string> {
    return new Promise((resolve, reject) => {
        if(!process.env.AC_USER || !process.env.AC_PASS) {
            reject('No username or password defined.');
            return;
        }

        session.post(ACAPELABOX_URL + '/dovaas.php', {
            form: {
                text: '\\vct=' + (shaping + 100) + '\\ \\spd=' + (rate + 180) + '\\ ' + text,
                voice: voiceId,
                listen: '1',
                format: 'MP3',
                codecMP3: '1',
                spd: (rate + 180).toString(),
                vct: (shaping + 100).toString(),
                byline: '0',
                ts: Math.round(Date.now() / 1000)
            },
            headers: HEADERS
        }, async (err, res, body) => {
            if(err) { reject(err); return; }

            if(res.statusCode == 403) {
                if(triedAgain) {
                    reject(new Error('Unable to log in to AcapelaBox.'));
                    return;
                }

                try {
                    await login();

                    resolve(await makeVoice(voiceId, text, rate, shaping, true));
                    return;
                } catch(e) {
                    reject(e);
                    return;
                }
            }

            resolve(JSON.parse(body).snd_url);
        });
    });
}

export const voices: { [key: string]: string} = {
    ella: 'ella22k',
    emilio: 'emilioenglish22k',
    josh: 'josh22k',
    karren: 'karen22k',
    kenny: 'kenny22k',
    laura: 'laura22k',
    nelly: 'nelly22k',
    rod: 'rod22k',
    ryan: 'ryan22k',
    saul: 'saul22k',
    scott: 'scott22k',
    sharon: 'sharon22k',
    tracy: 'tracy22k',

    will: 'will22k',
    badguy: 'willbadguy22k',
    joe: 'willfromafar22k',
    happy: 'willhappy22k',
    sad: 'willsad22k',
    close: 'willupclose22k',

    thug: 'willlittlecreature22k',
    daddy: 'willoldman22k',
    nigga: 'micah22k',
    bun: 'valeriaenglish22k',

    brit: 'queenelizabeth22k',
    deepa: 'deepa22k',
    aussie: 'tyler22k',
    klaus: 'klaus22k',
    illegal: 'rodrigo22k',
    chink: 'lulu22k',
    pussy: 'antoine22k',
    weeb: 'sakura22k',
    bomb: 'nizar22k',
    cyka: 'alyona22k',
};