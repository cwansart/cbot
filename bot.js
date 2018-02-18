"use strict";

var auth = require('./auth.json');
var cheerio = require('cheerio');
var config = require('./config.json');
var DateDiff = require('date-diff');
var dateFormat = require('dateformat');
var Discord = require('discord.io');
var http = require('http');
var jokes = require('./jokes.json');
var logger = require('winston');
var nameMap = require('./name-map.json');
var onExit = require('signal-exit');

// global variables
let whoWasLast = null;
let lastPostDate = new Date();

// prepare logging
logger.remove(logger.transports.Console);
logger.add(logger.transports.Console, {
  colorize: true
});
logger.level = 'debug';

// now the bot stuff
var bot = new Discord.Client({
  token: auth.token,
  autorun: true
});

bot.on('ready', function() {
  logger.info('Connected');
  logger.info('Logged in as: ');
  logger.info(bot.username + ' - (' + bot.id + ')');

  logger.info('Start periodical check');
  const oneMinute = 60000;
  setInterval(function() {
    getGameData((whoseTurn) => {
      const now = new Date();
      const diff = new DateDiff(lastPostDate, now);

      if (whoseTurn !== whoWasLast) {
        lastPostDate = now;
      }

      if (whoseTurn !== whoWasLast || diff.hours() >= 1) {
        getGameData((whoseTurn) => {
          whoWasLast = whoseTurn;
          bot.sendMessage({
            to: config.channelId,
            message: `<@${nameMap[whoseTurn]}> ist am Zug!`
          });
        });
      }
    });
  }, (oneMinute * config.checkInterval));
});

bot.on('message', function(user, userId, channelId, message, event) {
  if (channelId != config.channelId) {
    logger.info(`Ignoring received message from channel ${channelId}. Ignoring it.`);
    return;
  }

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
      }
      break;

      case 'mutter':
      case 'deineMutter':
      case 'witz':
      case 'joke': {
        const rand = Math.round(Math.random() * jokes.length);
        bot.sendMessage({
          to: channelId,
          message: jokes[rand]
        });
      }
      break;

      case 'wer':
      case 'who': {
        bot.sendMessage({
          to: channelId,
          message: 'Moment, ich schau mal nach...'
        });
        
        getGameData((whoseTurn) => {
          whoWasLast = whoseTurn;
          bot.sendMessage({
            to: channelId,
            message: `<@${nameMap[whoseTurn]}> ist am Zug!`
          });
        }, () => {
          bot.sendMessage({
            to: channelId,
            message: 'Meh... Da hat was nicht hingehauen :('
          });
        });
      }
      break;

      case 'wann': {
        const date = dateFormat(new Date(), 'H:MM');
        let message = `Es ist ${date}. :-)`;

        if (whoWasLast !== null) {
          message = `Es ist ${date}, und <@${nameMap[whoWasLast]}> hat immer noch nicht gespielt... ¯\\\_(ツ)_/¯`
        }

        bot.sendMessage({
          to: channelId,
          message 
        });
      }
      break;
	  
	  case 'wo':
	  case 'where': {
		bot.sendMessage({
		  to: channelId,
		  `In Sid Meier’s Civilization 5`
		});
	  }
	  break;
    }
  }
});

// fetches the game data and runs onSuccess callback if succuessful, onFailure otherwise
var getGameData = (onSuccess, onFailure = nothingOnFailure) => {
  const options = {
    hostname: 'multiplayerrobot.com',
    port: 80,
    path: '/Game/Details?id=' + config.gameId,
    method: 'POST',
    headers: {
    }
  };

  const req = http.request(options, (res) => {
    logger.debug(`STATUS: ${res.statusCode}`);
    logger.debug(`HEADERS: ${JSON.stringify(res.headers)}`);

    let whoseTurn = null;
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      const ch = cheerio.load(chunk);
      const whoseTurnTemp = ch('.avatar.game-avatar.tooltip').attr('alt');

      if (whoseTurnTemp !== undefined) {
        whoseTurn = whoseTurnTemp;
      }
    });
    res.on('end', () => {
      logger.info('No more data in response.');
      if (whoseTurn !== null) {
        onSuccess(whoseTurn);
      } else {
        onFailure();
      }
    });
  });

  req.on('error', (e) => {
    logger.error(`problem with request: ${e.message}`);
  });

  req.write("");
  req.end();
}

// ensure that the bot disconnects immediately
onExit(function (code, signal) {
  logger.info('Shutting process down...');
  bot.disconnect();
});

// to use a name instead of an empty function as callbacks
var nothing = () => {};
var nothingOnFailure = nothing;
