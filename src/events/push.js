
const BaseEvent = require("./base");

module.exports = class PushEvent extends BaseEvent {
    // BaseEvent

    buildId() {
        return `${this.repoId}/${this.data.before.substr(0, 7)}...${this.data.after.substr(0, 7)}`;
    }

    buildDetails() {
        this.branch = this.data.ref.split("/").pop();

        this.commits = this.data.commits.map(commit => ({
            id:     `${this.repoId}/${commit.id}`,
            author: commit.author.username,
            title:  commit.message,
            text:   `[${commit.author.username}: <${commit.url}|${commit.id.substr(0, 7)}>] ${commit.message.split("\n").shift()}`,
        }));

        this.setDetails({
            title: `Pushed by ${this.sender}`,
            text:  this.commits.map(commit => commit.text).join("\n"),
        });
    }

    pretext() {
        return `[<${this.repo.html_url}|${this.repo.full_name}>] Branch '${this.branch}': <${this.data.compare}|${this.commits.length} Commits>`;
    }
};
