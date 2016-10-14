
const BaseEvent = require("./base");

module.exports = class PushEvent extends BaseEvent {
    //
    // Private
    //

    _buildId() {
        return `${this.repoId}/${this.data.before.substr(0, 7)}...${this.data.after.substr(0, 7)}`;
    }

    _buildParticipants() {
        return [...new Set([this.repo.owner.login, this.sender])];
    }

    _buildDetails() {
        this.branch = this.data.ref.split("/").pop();

        this.commits = this.info.map(commit => ({
            id:     `${this.repoId}/${commit.id}`,
            author: commit.author.username,
            title:  commit.message,
            text:   `[${commit.author.username}: <${commit.url}|${commit.id.substr(0, 7)}>] ${commit.message.split("\n").shift()}`,
        }));

        this._setDetails({
            title: `Pushed by ${this.sender}`,
            text:  this.commits.map(commit => commit.text).join("\n"),
        });
    }

    _pretext() {
        return `[<${this.repo.html_url}|${this.repo.full_name}>] Branch '${this.branch}': <${this.data.compare}|${this.commits.length} Commits>`;
    }
};
