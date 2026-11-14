const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const sonarjs = require("eslint-plugin-sonarjs");
const globals = require("globals");

module.exports = [
	{
		ignores: ["node_modules/**", "dist/**", "coverage/**", "docs/**", "prisma/**", "uploads/**"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	sonarjs.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			globals: globals.node,
			parserOptions: {
				projectService: true,
				tsconfigRootDir: __dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
		},
	},
	{
		files: ["**/*.js"],
		languageOptions: {
			globals: globals.node,
			sourceType: "commonjs",
		},
		rules: {
			"@typescript-eslint/no-require-imports": "off",
		},
	},
	{
		files: ["tests/**/*.ts"],
		rules: {
			"sonarjs/no-duplicate-string": "off",
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
];
