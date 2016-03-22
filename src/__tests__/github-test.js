
"use strict";

jest.unmock("../github");

describe("github", () => {
    let robot;
    let redis;

    beforeEach(() => {
        const Redis = require("ioredis");

        robot = {
            brain: {
                userForId: jest.fn(function(userId) {
                    return {
                        name: userId.replace("ID_", "")
                    };
                })
            },
            logger: {
                info: jest.fn()
            },
            emit: jest.fn(),
        };
        redis = new Redis();
    });

    afterEach(() => {
        robot = null;
        redis = null;
    });

    function create() {
        const Github = require("../github");
        return new Github(robot, redis);
    }

    const userId = "USER_ID";
    const user = {
        id: userId
    };

    describe("logins", () => {
        const alias = "ALIAS";

        it("sets login", () => {
            const github = create();
            github.setLoginForUser(user, alias);

            expect(redis.defineCommand).toBeCalledWith("setLoginForUser", jasmine.any(Object));
            expect(redis.setLoginForUser).toBeCalledWith(userId, alias);
        });

        it("gets login", () => {
            const github = create();
            const reply  = jest.fn();

            github.loginForUser(user, reply);
            expect(redis.hget).toBeCalledWith("users", userId, jasmine.any(Function));

            const cb = redis.hget.mock.calls[0][2];

            cb(null, null);
            expect(reply).lastCalledWith(null);

            cb(null, alias);
            expect(reply).lastCalledWith(alias);
        });

        it("clears login", () => {
            const github = create();
            github.setLoginForUser(user);

            expect(redis.defineCommand).toBeCalledWith("setLoginForUser", jasmine.any(Object));
            expect(redis.setLoginForUser).lastCalledWith(userId, undefined);
        });
    });

    describe("watches", () => {
        function defineTests(type) {
            function capitalize(str) {
                return str.charAt(0).toUpperCase() + str.slice(1);
            }

            it(`adds ${type} watches`, () => {
                const github = create();
                let   result;

                redis.exec.mockReturnValue(true)
                result = github[`addWatcherFor${capitalize(type)}`](user, "FOO/BAR");
                expect(result).toEqual(true);

                redis.exec.mockReturnValue(false)
                result = github[`addWatcherFor${capitalize(type)}`](user, "FOO/BAR");
                expect(result).toEqual(false);

                expect(redis.multi).toBeCalled();
                expect(redis.sadd).toBeCalledWith(`${type}:foo/bar`, userId);
                expect(redis.sadd).toBeCalledWith(`user:${userId}:${type}`, "foo/bar");
                expect(redis.exec).toBeCalled();
            });

            it(`gets ${type} watches`, () => {
                const github = create();
                const reply  = jest.fn();

                github[`${type}sForUser`](user, reply);
                expect(redis.smembers).toBeCalledWith(`user:${userId}:${type}`, jasmine.any(Function));

                const cb = redis.smembers.mock.calls[0][1];
                let   items;

                items = [];
                cb(null, items);
                expect(reply).lastCalledWith(items);

                items = ["FOO/BAR", "BAZ/FOO"];
                cb(null, items);
                expect(reply).lastCalledWith(items);
            });

            it(`removes ${type} watches`, () => {
                const github = create();
                let   result;

                redis.exec.mockReturnValue(true)
                result = github[`removeWatcherFor${capitalize(type)}`](user, "FOO/BAR");
                expect(result).toEqual(true);

                redis.exec.mockReturnValue(false)
                result = github[`removeWatcherFor${capitalize(type)}`](user, "FOO/BAR");
                expect(result).toEqual(false);

                expect(redis.multi).toBeCalled();
                expect(redis.srem).toBeCalledWith(`${type}:foo/bar`, userId);
                expect(redis.srem).toBeCalledWith(`user:${userId}:${type}`, "foo/bar");
                expect(redis.exec).toBeCalled();
            });
        }

        describe("repos", () => {
            defineTests("repo");
        });

        describe("issues", () => {
            defineTests("issue");
        });
    });

    describe("events", () => {
        const action    = "FOO!";
        const commented = "commented";
        const eventId   = "FOO_ID";
        const repoId    = "REPO_ID";
        const senderId  = "SENDER_ID";

        const participantsKey = `participants:${eventId}`;
        const issueKey        = `issue:${eventId}`;
        const repoKey         = `repo:${repoId}`;

        let data;
        let events;

        beforeEach(() => {
            data = {
                id: eventId,
                repoId,
                sender: senderId,
                action,
                participants: ["FOO_USER", "BAR_USER"],
            };

            events = require("../events");
            events.create.mockImplementation((action, data) => data);
        });

        afterEach(() => {
            data   = null;
            events = null;
        });

        it("creates the right event", () => {
            const github = create();
            const events = require("../events");

            github.handle("issue", data);
            expect(events.create).lastCalledWith(action, data);

            github.handle("issue_comment", data);
            expect(events.create).lastCalledWith(commented, data);

            github.handle("pull_request", data);
            expect(events.create).lastCalledWith(action, data);

            github.handle("pull_request_review_comment", data);
            expect(events.create).lastCalledWith(commented, data);
        });

        it("adds the participants without details", () => {
            const github = create();

            github.handle("issue", data);
            expect(redis.sadd).toBeCalledWith(participantsKey, data.participants);
            expect(redis.expire).toBeCalledWith(participantsKey, jasmine.any(Number));
            expect(redis.smembers).not.toBeCalled();
        });

        it("gets the participants with details", () => {
            const github = create();
            data.details = {};

            github.handle("issue", data);
            expect(redis.sadd).toBeCalledWith(participantsKey, data.participants);
            expect(redis.expire).toBeCalledWith(participantsKey, jasmine.any(Number));
            expect(redis.sunion).toBeCalledWith([issueKey]);
            expect(redis.smembers).toBeCalledWith(participantsKey);
            expect(redis.exec).toBeCalledWith(jasmine.any(Function));
        });

        it("gets watchers for opened", () => {
            const github = create();

            data.details = {};
            data.action  = "opened";

            github.handle("issue", data);
            expect(redis.sadd).toBeCalledWith(participantsKey, data.participants);
            expect(redis.expire).toBeCalledWith(participantsKey, jasmine.any(Number));
            expect(redis.sunion).toBeCalledWith([issueKey, repoKey]);
            expect(redis.smembers).toBeCalledWith(participantsKey);
            expect(redis.exec).toBeCalledWith(jasmine.any(Function));
        });

        it("notifies participants", () => {
            const github = create();

            data.details = {
                foo: "BAR"
            };
            github.handle("issue", data);

            const watchers     = ["ID_BAZ", "ID_FOO", "ID_BAR"];
            const participants = ["ABC", "XYZ", senderId];

            const fetchCb = redis.exec.mock.calls.pop()[0];
            fetchCb(null, [[], [], [null, watchers], [null, participants]]);

            expect(redis.hmget).toBeCalledWith("logins", participants);
            expect(redis.hget).toBeCalledWith("logins", senderId.toLowerCase());
            expect(redis.exec).toBeCalledWith(jasmine.any(Function));

            const participantLogins = participants.map(p => `ID_${p}`);
            const senderLogin       = `ID_${senderId}`;

            const notifyCb = redis.exec.mock.calls.pop()[0];
            notifyCb(null, [[null, participantLogins], [null, senderLogin]]);

            participantLogins.concat(watchers)
                .map(login => login.replace("ID_", ""))
                .filter(userName => userName !== senderId)
                .forEach(userName => {
                    expect(robot.emit).toBeCalledWith("slack-attachment", {
                        channel:     userName,
                        attachments: [data.details],
                    });
                });
        });
    });
});

