
"use strict";

const Redis = jest.fn();
Redis.prototype = {
    defineCommand: jest.fn(function(name) {
        this[name] = jest.fn();
    }),

    set: jest.fn().mockReturnThis(),
    get: jest.fn().mockReturnThis(),

    hget:  jest.fn().mockReturnThis(),
    hmget: jest.fn().mockReturnThis(),

    sadd:     jest.fn().mockReturnThis(),
    smembers: jest.fn().mockReturnThis(),
    srem:     jest.fn().mockReturnThis(),
    sunion:   jest.fn().mockReturnThis(),

    expire: jest.fn().mockReturnThis(),

    multi:    jest.fn().mockReturnThis(),
    pipeline: jest.fn().mockReturnThis(),

    exec: jest.fn(),
};

module.exports = Redis;
