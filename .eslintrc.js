
module.exports = {
    "extends": "airbnb",
    "env": {
        "node": true,
    },

    "plugins": [
        "import",
    ],

    "rules": {
        "class-methods-use-this": "off",
        "indent": ["warn", 4],
        "key-spacing": ["error", {
            "align": "value",
        }],
        "max-len": "off",
        "no-cond-assign": ["error", "except-parens"],
        "no-multi-spaces": ["error", {
            "exceptions": {
                "AssignmentExpression": true,
                "ImportDeclaration":    true,
                "VariableDeclarator":   true,
            },
        }],
        "no-underscore-dangle": "off",
        "no-use-before-define": ["error", {
            "functions": false,
        }],
        "quotes": ["error", "double"],
    }
};
