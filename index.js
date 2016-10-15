
const Path = require("path");

module.exports = (robot) => {
    const path = Path.resolve(__dirname, "src");
    robot.loadFile(path, "github-spy.js");
};
