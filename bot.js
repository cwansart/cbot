"use strict";

// library includes
const DateDiff = require('date-diff');
const dateFormat = require('dateformat');
const Discord = require('discord.io');
const http = require('http');
const logger = require('winston');
const onExit = require('signal-exit');

// file includes
const auth = require('./auth.json');
const config = require('./config.json');
const jokes = require('./jokes.json');
const map = require('./map.json');

// global constants
const playerIdKeys = Object.keys(map).join('_');

// global variables
let whoWasLast = null;
let lastPostDate = new Date();

// global aliases
var nothing = () => {
};
var nothingOnFailure = nothing;

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
  bot.setPresence({game: {name: 'mit deiner Mutter'}});

  logger.info('Connected');
  logger.info('Logged in as: ');
  logger.info(bot.username + ' - (' + bot.id + ')');

  logger.info('Start periodical check');
  const oneMinute = 60000;
  setInterval(function () {
    getGameData((currentPlayer) => {
      const now = new Date();
      const diff = new DateDiff(lastPostDate, now);

      if (currentPlayer !== whoWasLast) {
        lastPostDate = now;
      }

      if (currentPlayer !== whoWasLast || diff.hours() >= 1) {
        whoWasLast = currentPlayer;
        bot.sendMessage({
          to: config.channelId,
          message: `<@${map[currentPlayer]}> ist am Zug!`
        });
      }
    });
  }, (oneMinute * config.checkInterval));
});

bot.on('message', function (user, userId, channelId, message, event) {
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

        getGameData((currentPlayer) => {
          whoWasLast = currentPlayer;
          bot.sendMessage({
            to: channelId,
            message: `<@${map[currentPlayer]}> ist am Zug!`
          });
        }, () => {
          bot.sendMessage({
            to: channelId,
            message: 'Meh... Da hat was nicht hingehauen :('
          });
        });
        break;
      }

      case 'wann': {
        const date = dateFormat(new Date(), 'H:MM');
        let message = `Es ist ${date}. :-)`;

        if (whoWasLast !== null) {
          message = `Es ist ${date}, und <@${map[whoWasLast]}> hat immer noch nicht gespielt... ¯\\\_(ツ)_/¯`
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
          message: `In Sid Meier’s Civilization 5`
        });
        break;
      }
    }

    args = args.splice(1);
  }
});

bot.on('disconnect', function (event) {
  logger.warn(`Bot has been disconnected at ${new Date()}: ${JSON.stringify(event)}`);
});

// fetches the game data and runs onSuccess callback if succuessful, onFailure otherwise
var getGameData = (onSuccess, onFailure = nothingOnFailure) => {
  const options = {
    hostname: 'multiplayerrobot.com',
    port: 80,
    path: '/api/Diplomacy/GetGamesAndPlayers?playerIDText=' + playerIdKeys + '&authKey=' + auth.token.gmr,
    method: 'GET',
    headers: {
      "Accept": "application/json"
    }
  };

  const req = http.request(options, (res) => {
    logger.debug(`STATUS: ${res.statusCode}`);
    logger.debug(`HEADERS: ${JSON.stringify(res.headers)}`);

    let data = [];
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      data.push(chunk);
    });
    res.on('end', () => {
      logger.info('No more data in response.');

      try {
        const response = JSON.parse(data.join(''));
        onSuccess(response.Games[0].CurrentTurn.UserId);
      } catch(e) {
        onFailure();
      }
    });
  });

  req.on('error', (e) => {
    logger.error(`problem with request: ${e.message}`);
  });

  req.write("");
  req.end();
};

// ensure that the bot disconnects immediately
onExit(function (code, signal) {
  logger.info('Shutting process down...');
  bot.disconnect();
});
