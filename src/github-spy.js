// Description:
//   Notifies users of relevant GitHub repo updates
//
// Commands:
//   hubot alias <username> - Registers your github username.
//   hubot alias[?] - Lists your registered github username.
//   hubot unalias - Unregisters your github username with.
//   hubot watch <user/repository> - Watches a github repository for updates.
//   hubot repos[?] - Lists the github repositories you're watching.
//   hubot unwatch <user/repository> - Stops watching a github repository.
//   hubot watch <user/repository#number> - Watches a github issue for updates.
//   hubot issues[?] - Lists the github issues you're watching.
//   hubot unwatch <user/repository#number> - Stops watching a github issue.
//
// Author:
//   jaredru

const Redis  = require("ioredis");
const Github = require("./github");

//
// Hubot
//

module.exports = function init(robot) {
    const redis  = new Redis(process.env.HUBOT_GITHUB_SPY_REDIS_URL);
    const github = new Github(robot, redis);

    //
    // Logins
    //

    robot.respond(/alias\s+([\w-]+)\s*$/i, (res) => {
        const user  = res.message.user;
        const alias = res.match[1];

        github.setLoginForUser(user, alias);
        robot.messageRoom(user.id, `Your GitHub alias is set to ${alias}.`);
    });

    robot.respond(/alias\??$/i, (res) => {
        const user = res.message.user;

        github.loginForUser(user, (alias) => {
            if (alias) {
                robot.messageRoom(user.id, `Your GitHub alias is set to ${alias}.`);
            } else {
                robot.messageRoom(user.id, "You haven't set a GitHub alias.");
            }
        });
    });

    robot.respond(/unalias\s*$/i, (res) => {
        const user = res.message.user;

        github.loginForUser(user, (alias) => {
            if (alias) {
                github.setLoginForUser(user);
                robot.messageRoom(user.id, "Your GitHub alias has been removed.");
            } else {
                robot.messageRoom(user.id, "You haven't set a GitHub alias.");
            }
        });
    });

    // Repos

    robot.respond(/watch ([\w-.]+\/[\w-.]+)\s*$/i, (res) => {
        const user = res.message.user;
        const repo = res.match[1];

        github.addWatcherForRepo(user, repo);
        robot.messageRoom(user.id, `You are now watching the GitHub repo ${repo}.`);
    });

    robot.respond(/repos?\??\s*$/i, (res) => {
        const user = res.message.user;
        listReposForUser(user);
    });

    robot.respond(/unwatch ([\w-.]+\/[\w-.]+)\s*$/i, (res) => {
        const user = res.message.user;
        const repo = res.match[1];

        if (github.removeWatcherForRepo(user, repo)) {
            robot.messageRoom(user.id, `You are no longer watching the GitHub repo ${repo}.`);
        } else {
            robot.messageRoom(user.id, `You are not watching the GitHub repo ${repo}.`);
        }
    });

    // Issues/PRs

    robot.respond(/watch ([\w-.]+\/[\w-.]+#\d+)\s*$/i, (res) => {
        const user  = res.message.user;
        const issue = res.match[1];

        github.addWatcherForIssue(user, issue);
        robot.messageRoom(user.id, `You are now watching the GitHub issue ${issue}.`);
    });

    robot.respond(/issues?\??\s*$/i, (res) => {
        const user = res.message.user;
        listIssuesForUser(user);
    });

    robot.respond(/unwatch ([\w-.]+\/[\w-.]+#\d+)\s*$/i, (res) => {
        const user  = res.message.user;
        const issue = res.match[1];

        if (github.removeWatcherForIssue(user, issue)) {
            robot.messageRoom(user.id, `You are no longer watching the GitHub issue ${issue}.`);
        } else {
            robot.messageRoom(user.id, `You are not watching the GitHub issue ${issue}.`);
        }
    });

    // Incoming

    robot.router.post("/github-spy", (req, res) => {
        const event = req.headers["x-github-event"];
        const body  = req.body;

        github.handle(event, body);
        res.send("OK");
    });

    function listReposForUser(user) {
        github.reposForUser(user, (repos) => {
            listItemsForUser("repos", repos, user);
        });
    }

    function listIssuesForUser(user) {
        github.issuesForUser(user, (issues) => {
            listItemsForUser("issues", issues, user);
        });
    }

    function listItemsForUser(type, items, user) {
        if (items.length) {
            const formatted = items
                .sort()
                .map(item => `  - ${item}`)
                .join("\n");

            robot.messageRoom(user.id, `You are watching the GitHub ${type}:\n${formatted}`);
        } else {
            robot.messageRoom(user.id, `You are not watching any GitHub ${type}.`);
        }
    }
};
