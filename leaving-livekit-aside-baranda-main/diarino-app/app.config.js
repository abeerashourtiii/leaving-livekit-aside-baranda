const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

module.exports = ({ config }) => ({
	...config,
	extra: {
		...config.extra,
		supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
		supabaseAnonKey:
			process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
			process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
	},
});