"use strict";

// library includes
const DateDiff = require('date-diff');
const dateFormat = require('dateformat');
const Discord = require('discord.io');
const http = require('http');
const logger = require('winston');
const onExit = require('signal-exit');
const fs = require('fs');

// file includes
const auth = require('./auth.json');
const config = require('./config.json');
const jokes = require('./jokes.json');
const map = require('./map.json');
const notificationPrefixes = require('./notification-prefix.json');

// global constants
const playerIdKeys = Object.keys(map).join('_');

// global variables
let whoWasLast = null;
let lastPostDate = new Date();
let checkInterval = null;
let roundStarted = null;

// Extend the Date prototype
Date.prototype.addHours = function(h) {    
  this.setTime(this.getTime() + (h*60*60*1000)); 
  return this;   
};

// prepare logging
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
  colorize: true
});
logger.add(logger.transports.File, {
  filename: 'cbot.log'
});
logger.level = 'debug';

// now the bot stuff
let bot = new Discord.Client({
  token: auth.token.discord,
  autorun: true
});

bot.on('ready', function () {
  bot.setPresence({game: {name: 'CiV'}});

  logger.info('Connected');
  logger.info('Logged in as: ');
  logger.info(bot.username + ' - (' + bot.id + ')');

  whoWasLast = restoreLastPlayer();

  logger.info('Start periodical check');
  const oneMinute = 60000;
  checkInterval = setInterval(function () {
    getGameData((currentPlayer, started) => {
      const now = new Date();
      const diff = new DateDiff(lastPostDate, now);
      roundStarted = started;

      if (currentPlayer !== whoWasLast) {
        lastPostDate = now;
      }

      if (currentPlayer !== whoWasLast) {
        whoWasLast = currentPlayer;
        saveLastPlayer(whoWasLast);
        bot.sendMessage({
          to: config.channelId,
          message: getTurnMessage(currentPlayer)
        });
      }
    });
  }, (oneMinute * config.checkInterval));
});

bot.on('message', function (user, userId, channelId, message) {
  logger.debug(`Calling onMessage; user: ${user}, userId: ${userId}, channelId: ${channelId}, message: ${message}`);

  /*
  if (channelId != config.channelId) {
    logger.info(`Ignoring received message from channel ${channelId}. Ignoring it.`);
    return;
  }
  */

  if (message.substring(0, 1) === '!') {
    let args = message.substring(1).split(' ');
    const cmd = args[0];
    args = args.splice(1);
    switch (cmd) {
      case 'ping': {
        bot.sendMessage({
          to: channelId,
          message: 'pong'
        });
        break;
      }

      case 'mutter':
      case 'deineMutter':
      case 'witz':
      case 'joke': {
        const rand = Math.round(Math.random() * jokes.length);
        let joke = jokes[rand];
        if (!args[0]) {
          bot.sendMessage({
            to: channelId,
            message: joke
          });
        } else if (args[0].substring(0, 2) === '<@') {
          if (joke && joke.substring(0, 12) === 'Deine Mutter') {
            joke = joke.replace('Deine Mutter', args[0])
              .replace('ihr', 'sein')
              .replace('sie', 'er')
              .replace('er hätten', 'sie hätten'); // fixing issue with one joke
            bot.sendMessage({
              to: channelId,
              message: joke
            });
          } else {
            bot.sendMessage({
              to: channelId,
              message: args[0] + ': ' + joke
            });
          }
        }
        break;
      }

      case 'wer':
      case 'who': {
        bot.sendMessage({
          to: channelId,
          message: 'Moment, ich schau mal nach...'
        });

        getGameData((currentPlayer, started) => {
          roundStarted = started;
          whoWasLast = currentPlayer;

          bot.sendMessage({
            to: channelId,
            message: getTurnMessage(currentPlayer)
          });
        }, () => {
          bot.sendMessage({
            to: channelId,
            message: 'https://giphy.com/gifs/colin-farrell-i-dont-know-XeXzWgD6P4LG8'
            //message: 'Meh... Da hat was nicht hingehauen :('
          });
        });
        break;
      }

      case 'wann':
      case 'when': {
        const now = new Date();
        let lastRound = new Date(roundStarted);
        logger.info(`lastRound: ${lastRound}`);
        let message = `Es ist ${dateFormat(now, 'H:MM')}. :-)`;
        lastRound.addHours(2);
        let diff = new DateDiff(now, lastRound);
        
        let time = ``;
        let days = Math.floor(diff.days());
        let hours = Math.floor(diff.hours() - (days * 24));
        let minutes = Math.floor(diff.minutes() - (hours * 60) - (days * 24 * 60));
        if (hours < 0) hours = 0;
        if (minutes < 0) minutes = 0;
        
        // Set time string to correct local phrase
        if (days === 1) {
          time += '1 Tag, '
        } else if (days > 1) {
          time += `${days} Tage `;
        }
        if (hours === 1) {
          time += '1 Stunde';
        } else if (hours > 1) {
          time += `${hours} Stunden`;
        }
        if (hours > 0) {
          time += ' und ';
        }
        if (minutes === 1) {
          time += '1 Minute';
        } else {
          time += `${minutes} Minuten`;
        }
        
        if (whoWasLast !== null) {
          message = `Die letzte Runde ist **${time}** her und <@${map[whoWasLast]}> hat immer noch nicht gespielt... ¯\\\_(ツ)_/¯`;
        }

        bot.sendMessage({
          to: channelId,
          message
        });
        break;
      }

      case 'wo':
      case 'where': {
        bot.sendMessage({
          to: channelId,
          message: 'In Sid Meier’s Civilization 5'
        });
        break;
      }
    }
  }
});

bot.on('disconnect', function(erMsg, code) {
  logger.warn(`Bot has been disconnected at ${new Date()}: ${erMsg} (${code})`);
  clearInterval(checkInterval);
  checkInterval = null;
  bot.connect();
});

// fetches the game data and runs onSuccess callback if successful, onFailure otherwise
const getGameData = (onSuccess, onFailure) => {
  const options = {
    hostname: 'multiplayerrobot.com',
    port: 80,
    path: `/api/Diplomacy/GetGamesAndPlayers?playerIDText=${playerIdKeys}&authKey=${auth.token.gmr}`,
    method: 'GET',
    headers: {
      "Accept": "application/json"
    }
  };

  const req = http.request(options, (res) => {
    let data = [];
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      data.push(chunk);
    });
    res.on('end', () => {
      logger.info('No more data in response.');

      try {
        const response = JSON.parse(data.join(''));
        logger.debug(`response: ${data}`);
        onSuccess(response.Games[0].CurrentTurn.UserId, response.Games[0].CurrentTurn.Started);
      } catch(e) {
        if (onFailure instanceof Function) {
          onFailure();
        }
      }
    });
  });

  req.on('error', (e) => {
    logger.error(`problem with request: ${e.message}`);
  });

  req.write('');
  req.end();
};

const getTurnMessage = (currentPlayer) => {
  const prefix = notificationPrefixes[currentPlayer] || '';
  return `<@${map[currentPlayer]}> ist am Zug! ${prefix}`;
};

const saveLastPlayer = (lastPlayer) => {
  fs.writeFile('lastPlayer.save', lastPlayer, 'utf8', function (err,data) {
    if (err) {
      logger.error(`Error in saveLastPlayer: ${err.message}`);
    }
  });
};

const restoreLastPlayer = () => {
  fs.readFile('lastPlayer.save', 'utf8', function (err,data) {
    if (err) {
          logger.error(`Error in restoreLastPlayer: ${err.message}`);
          return null;
        }
    // console.log(data);
    return data;
  });
};

// ensure that the bot disconnects immediately
onExit(function () {
  logger.info('Shutting process down...');
  bot.disconnect();
});
