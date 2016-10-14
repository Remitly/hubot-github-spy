
const CommitCommentEvent = require("./commit-comment");
const IssueEvent = require("./issue");
const PullRequestEvent = require("./pull-request");
const PushEvent = require("./push");

module.exports = {
    create(action, data) {
        let Type;
        let info;

        switch (action) {
        case "push":
            Type = PushEvent;
            info = data.commits;
            break;

        case "commit_comment":
            Type = CommitCommentEvent;
            info = data.comment;
            break;

        default:
            // pull requests are just a specialized type of issue
            Type = data.pull_request || (data.issue && data.issue.pull_request) ? PullRequestEvent : IssueEvent;
            info = data.pull_request || data.issue;
        }

        // create and return the event type
        const repo = data.repository;
        return new Type(repo, info, action, data);
    },
};
