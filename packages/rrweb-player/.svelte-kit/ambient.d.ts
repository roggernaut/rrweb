
// this file is generated — do not edit it


/// <reference types="@sveltejs/kit" />

/**
 * Environment variables [loaded by Vite](https://vitejs.dev/guide/env-and-mode.html#env-files) from `.env` files and `process.env`. Like [`$env/dynamic/private`](https://kit.svelte.dev/docs/modules#$env-dynamic-private), this module cannot be imported into client-side code. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://kit.svelte.dev/docs/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://kit.svelte.dev/docs/configuration#env) (if configured).
 * 
 * _Unlike_ [`$env/dynamic/private`](https://kit.svelte.dev/docs/modules#$env-dynamic-private), the values exported from this module are statically injected into your bundle at build time, enabling optimisations like dead code elimination.
 * 
 * ```ts
 * import { API_KEY } from '$env/static/private';
 * ```
 * 
 * Note that all environment variables referenced in your code should be declared (for example in an `.env` file), even if they don't have a value until the app is deployed:
 * 
 * ```
 * MY_FEATURE_FLAG=""
 * ```
 * 
 * You can override `.env` values from the command line like so:
 * 
 * ```bash
 * MY_FEATURE_FLAG="enabled" npm run dev
 * ```
 */
declare module '$env/static/private' {
	export const CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: string;
	export const CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: string;
	export const npm_package_exports___node_polyfills_types: string;
	export const CLAUDE_CODE_MESSAGING_TOKEN: string;
	export const NoDefaultCurrentDirectoryInExePath: string;
	export const npm_package_scripts_test_cross_platform_build: string;
	export const CLAUDE_EFFORT: string;
	export const CLAUDE_CODE_ENTRYPOINT: string;
	export const npm_package_exports___vite_import: string;
	export const npm_package_exports___hooks_import: string;
	export const NODE: string;
	export const npm_package_dependencies_sade: string;
	export const INIT_CWD: string;
	export const npm_package_devDependencies_typescript: string;
	export const npm_package_homepage: string;
	export const npm_config_version_git_tag: string;
	export const BAGGAGE: string;
	export const CLAUDE_CODE_HOST_SESSION_ID: string;
	export const CLAUDE_PREVIEW_CLASSIFIER_FLOOR: string;
	export const CLAUDE_CODE_OAUTH_SCOPES: string;
	export const SHELL: string;
	export const npm_package_devDependencies_vite: string;
	export const npm_package_dependencies_devalue: string;
	export const CLAUDE_PID: string;
	export const CLAUDE_CODE_CHILD_SESSION: string;
	export const CLAUDE_CODE_EAGER_FLUSH: string;
	export const TMPDIR: string;
	export const npm_config_global_prefix: string;
	export const npm_package_scripts_lint: string;
	export const npm_config_init_license: string;
	export const npm_package_dependencies_set_cookie_parser: string;
	export const npm_package_dependencies_cookie: string;
	export const CLAUDE_AGENT_SDK_VERSION: string;
	export const MallocNanoZone: string;
	export const COLOR: string;
	export const USE_LOCAL_OAUTH: string;
	export const npm_config_noproxy: string;
	export const CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: string;
	export const npm_package_devDependencies_svelte_preprocess: string;
	export const npm_config_registry: string;
	export const npm_config_local_prefix: string;
	export const npm_package_dependencies_import_meta_resolve: string;
	export const npm_package_repository_url: string;
	export const GIT_EDITOR: string;
	export const AI_AGENT: string;
	export const npm_package_readmeFilename: string;
	export const USER: string;
	export const npm_package_exports___node_import: string;
	export const npm_package_description: string;
	export const npm_package_exports___package_json: string;
	export const npm_package_dependencies_esm_env: string;
	export const npm_package_license: string;
	export const API_TIMEOUT_MS: string;
	export const COMMAND_MODE: string;
	export const npm_config_globalconfig: string;
	export const npm_package_exports___import: string;
	export const npm_package_repository_directory: string;
	export const SSH_AUTH_SOCK: string;
	export const __CF_USER_TEXT_ENCODING: string;
	export const npm_package_bin_svelte_kit: string;
	export const npm_execpath: string;
	export const npm_package_devDependencies__types_sade: string;
	export const npm_package_peerDependencies__sveltejs_vite_plugin_svelte: string;
	export const npm_package_devDependencies_svelte: string;
	export const YARN_IGNORE_PATH: string;
	export const CLAUDE_CODE_REPORT_FINDINGS: string;
	export const PATH: string;
	export const npm_config_argv: string;
	export const npm_package_scripts_postinstall: string;
	export const MCP_CONNECTION_NONBLOCKING: string;
	export const npm_package_devDependencies_rollup: string;
	export const npm_package_dependencies_magic_string: string;
	export const npm_package_json: string;
	export const _: string;
	export const npm_config_userconfig: string;
	export const npm_config_init_module: string;
	export const COREPACK_ENABLE_DOWNLOAD_PROMPT: string;
	export const __CFBundleIdentifier: string;
	export const npm_command: string;
	export const PWD: string;
	export const npm_lifecycle_event: string;
	export const EDITOR: string;
	export const npm_package_name: string;
	export const npm_package_types: string;
	export const npm_package_devDependencies__sveltejs_vite_plugin_svelte: string;
	export const npm_package_repository_type: string;
	export const npm_package_scripts_generate_types: string;
	export const npm_package_scripts_test_integration: string;
	export const npm_package_devDependencies__types_connect: string;
	export const npm_package_exports___node_polyfills_import: string;
	export const npm_package_exports___types: string;
	export const npm_config_version_commit_hooks: string;
	export const npm_config_npm_version: string;
	export const NODE_USE_SYSTEM_CA: string;
	export const XPC_FLAGS: string;
	export const npm_package_scripts_test_cross_platform_dev: string;
	export const npm_package_devDependencies_vitest: string;
	export const npm_package_dependencies_tiny_glob: string;
	export const npm_config_bin_links: string;
	export const npm_package_engines_node: string;
	export const npm_package_dependencies_sirv: string;
	export const npm_config_node_gyp: string;
	export const XPC_SERVICE_NAME: string;
	export const npm_package_version: string;
	export const npm_config_yes: string;
	export const SHLVL: string;
	export const HOME: string;
	export const npm_package_type: string;
	export const CLAUDE_CODE_DISABLE_CRON: string;
	export const ANTHROPIC_BASE_URL: string;
	export const npm_package_scripts_generate_version: string;
	export const npm_package_scripts_test: string;
	export const npm_package_scripts_check_all: string;
	export const CLAUDE_CODE_EXECPATH: string;
	export const npm_package_exports___vite_types: string;
	export const npm_package_exports___hooks_types: string;
	export const npm_config_save_prefix: string;
	export const npm_config_strict_ssl: string;
	export const DISABLE_MICROCOMPACT: string;
	export const MCP_SERVER_CONNECTION_BATCH_SIZE: string;
	export const npm_config_version_git_message: string;
	export const npm_config_cache: string;
	export const LOGNAME: string;
	export const npm_package_scripts_format: string;
	export const npm_package_peerDependencies_vite: string;
	export const npm_lifecycle_script: string;
	export const npm_package_peerDependencies_svelte: string;
	export const npm_config_ignore_path: string;
	export const COREPACK_ENABLE_AUTO_PIN: string;
	export const npm_package_devDependencies__types_set_cookie_parser: string;
	export const npm_config_user_agent: string;
	export const CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: string;
	export const npm_package_files_3: string;
	export const npm_package_dependencies__types_cookie: string;
	export const npm_config_version_git_sign: string;
	export const npm_config_ignore_scripts: string;
	export const CLAUDE_CODE_SESSION_ID: string;
	export const DISABLE_AUTOUPDATER: string;
	export const npm_package_files_2: string;
	export const npm_package_devDependencies__types_node: string;
	export const npm_package_devDependencies__playwright_test: string;
	export const npm_package_files_1: string;
	export const npm_package_devDependencies_dts_buddy: string;
	export const OSLogRateLimit: string;
	export const npm_package_files_0: string;
	export const npm_package_dependencies_mrmime: string;
	export const npm_package_dependencies_kleur: string;
	export const npm_config_init_version: string;
	export const npm_config_ignore_optional: string;
	export const CLAUDECODE: string;
	export const CLAUDE_CODE_MESSAGING_SOCKET: string;
	export const npm_package_exports___node_types: string;
	export const npm_package_files_6: string;
	export const npm_package_scripts_check: string;
	export const npm_package_files_5: string;
	export const npm_node_execpath: string;
	export const npm_config_prefix: string;
	export const USE_STAGING_OAUTH: string;
	export const npm_package_scripts_test_unit: string;
	export const npm_package_files_4: string;
	export const npm_config_version_tag_prefix: string;
}

/**
 * Similar to [`$env/static/private`](https://kit.svelte.dev/docs/modules#$env-static-private), except that it only includes environment variables that begin with [`config.kit.env.publicPrefix`](https://kit.svelte.dev/docs/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Values are replaced statically at build time.
 * 
 * ```ts
 * import { PUBLIC_BASE_URL } from '$env/static/public';
 * ```
 */
declare module '$env/static/public' {
	
}

/**
 * This module provides access to runtime environment variables, as defined by the platform you're running on. For example if you're using [`adapter-node`](https://github.com/sveltejs/kit/tree/main/packages/adapter-node) (or running [`vite preview`](https://kit.svelte.dev/docs/cli)), this is equivalent to `process.env`. This module only includes variables that _do not_ begin with [`config.kit.env.publicPrefix`](https://kit.svelte.dev/docs/configuration#env) _and do_ start with [`config.kit.env.privatePrefix`](https://kit.svelte.dev/docs/configuration#env) (if configured).
 * 
 * This module cannot be imported into client-side code.
 * 
 * Dynamic environment variables cannot be used during prerendering.
 * 
 * ```ts
 * import { env } from '$env/dynamic/private';
 * console.log(env.DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 * 
 * > In `dev`, `$env/dynamic` always includes environment variables from `.env`. In `prod`, this behavior will depend on your adapter.
 */
declare module '$env/dynamic/private' {
	export const env: {
		CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES: string;
		CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL: string;
		npm_package_exports___node_polyfills_types: string;
		CLAUDE_CODE_MESSAGING_TOKEN: string;
		NoDefaultCurrentDirectoryInExePath: string;
		npm_package_scripts_test_cross_platform_build: string;
		CLAUDE_EFFORT: string;
		CLAUDE_CODE_ENTRYPOINT: string;
		npm_package_exports___vite_import: string;
		npm_package_exports___hooks_import: string;
		NODE: string;
		npm_package_dependencies_sade: string;
		INIT_CWD: string;
		npm_package_devDependencies_typescript: string;
		npm_package_homepage: string;
		npm_config_version_git_tag: string;
		BAGGAGE: string;
		CLAUDE_CODE_HOST_SESSION_ID: string;
		CLAUDE_PREVIEW_CLASSIFIER_FLOOR: string;
		CLAUDE_CODE_OAUTH_SCOPES: string;
		SHELL: string;
		npm_package_devDependencies_vite: string;
		npm_package_dependencies_devalue: string;
		CLAUDE_PID: string;
		CLAUDE_CODE_CHILD_SESSION: string;
		CLAUDE_CODE_EAGER_FLUSH: string;
		TMPDIR: string;
		npm_config_global_prefix: string;
		npm_package_scripts_lint: string;
		npm_config_init_license: string;
		npm_package_dependencies_set_cookie_parser: string;
		npm_package_dependencies_cookie: string;
		CLAUDE_AGENT_SDK_VERSION: string;
		MallocNanoZone: string;
		COLOR: string;
		USE_LOCAL_OAUTH: string;
		npm_config_noproxy: string;
		CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH: string;
		npm_package_devDependencies_svelte_preprocess: string;
		npm_config_registry: string;
		npm_config_local_prefix: string;
		npm_package_dependencies_import_meta_resolve: string;
		npm_package_repository_url: string;
		GIT_EDITOR: string;
		AI_AGENT: string;
		npm_package_readmeFilename: string;
		USER: string;
		npm_package_exports___node_import: string;
		npm_package_description: string;
		npm_package_exports___package_json: string;
		npm_package_dependencies_esm_env: string;
		npm_package_license: string;
		API_TIMEOUT_MS: string;
		COMMAND_MODE: string;
		npm_config_globalconfig: string;
		npm_package_exports___import: string;
		npm_package_repository_directory: string;
		SSH_AUTH_SOCK: string;
		__CF_USER_TEXT_ENCODING: string;
		npm_package_bin_svelte_kit: string;
		npm_execpath: string;
		npm_package_devDependencies__types_sade: string;
		npm_package_peerDependencies__sveltejs_vite_plugin_svelte: string;
		npm_package_devDependencies_svelte: string;
		YARN_IGNORE_PATH: string;
		CLAUDE_CODE_REPORT_FINDINGS: string;
		PATH: string;
		npm_config_argv: string;
		npm_package_scripts_postinstall: string;
		MCP_CONNECTION_NONBLOCKING: string;
		npm_package_devDependencies_rollup: string;
		npm_package_dependencies_magic_string: string;
		npm_package_json: string;
		_: string;
		npm_config_userconfig: string;
		npm_config_init_module: string;
		COREPACK_ENABLE_DOWNLOAD_PROMPT: string;
		__CFBundleIdentifier: string;
		npm_command: string;
		PWD: string;
		npm_lifecycle_event: string;
		EDITOR: string;
		npm_package_name: string;
		npm_package_types: string;
		npm_package_devDependencies__sveltejs_vite_plugin_svelte: string;
		npm_package_repository_type: string;
		npm_package_scripts_generate_types: string;
		npm_package_scripts_test_integration: string;
		npm_package_devDependencies__types_connect: string;
		npm_package_exports___node_polyfills_import: string;
		npm_package_exports___types: string;
		npm_config_version_commit_hooks: string;
		npm_config_npm_version: string;
		NODE_USE_SYSTEM_CA: string;
		XPC_FLAGS: string;
		npm_package_scripts_test_cross_platform_dev: string;
		npm_package_devDependencies_vitest: string;
		npm_package_dependencies_tiny_glob: string;
		npm_config_bin_links: string;
		npm_package_engines_node: string;
		npm_package_dependencies_sirv: string;
		npm_config_node_gyp: string;
		XPC_SERVICE_NAME: string;
		npm_package_version: string;
		npm_config_yes: string;
		SHLVL: string;
		HOME: string;
		npm_package_type: string;
		CLAUDE_CODE_DISABLE_CRON: string;
		ANTHROPIC_BASE_URL: string;
		npm_package_scripts_generate_version: string;
		npm_package_scripts_test: string;
		npm_package_scripts_check_all: string;
		CLAUDE_CODE_EXECPATH: string;
		npm_package_exports___vite_types: string;
		npm_package_exports___hooks_types: string;
		npm_config_save_prefix: string;
		npm_config_strict_ssl: string;
		DISABLE_MICROCOMPACT: string;
		MCP_SERVER_CONNECTION_BATCH_SIZE: string;
		npm_config_version_git_message: string;
		npm_config_cache: string;
		LOGNAME: string;
		npm_package_scripts_format: string;
		npm_package_peerDependencies_vite: string;
		npm_lifecycle_script: string;
		npm_package_peerDependencies_svelte: string;
		npm_config_ignore_path: string;
		COREPACK_ENABLE_AUTO_PIN: string;
		npm_package_devDependencies__types_set_cookie_parser: string;
		npm_config_user_agent: string;
		CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH: string;
		npm_package_files_3: string;
		npm_package_dependencies__types_cookie: string;
		npm_config_version_git_sign: string;
		npm_config_ignore_scripts: string;
		CLAUDE_CODE_SESSION_ID: string;
		DISABLE_AUTOUPDATER: string;
		npm_package_files_2: string;
		npm_package_devDependencies__types_node: string;
		npm_package_devDependencies__playwright_test: string;
		npm_package_files_1: string;
		npm_package_devDependencies_dts_buddy: string;
		OSLogRateLimit: string;
		npm_package_files_0: string;
		npm_package_dependencies_mrmime: string;
		npm_package_dependencies_kleur: string;
		npm_config_init_version: string;
		npm_config_ignore_optional: string;
		CLAUDECODE: string;
		CLAUDE_CODE_MESSAGING_SOCKET: string;
		npm_package_exports___node_types: string;
		npm_package_files_6: string;
		npm_package_scripts_check: string;
		npm_package_files_5: string;
		npm_node_execpath: string;
		npm_config_prefix: string;
		USE_STAGING_OAUTH: string;
		npm_package_scripts_test_unit: string;
		npm_package_files_4: string;
		npm_config_version_tag_prefix: string;
		[key: `PUBLIC_${string}`]: undefined;
		[key: `${string}`]: string | undefined;
	}
}

/**
 * Similar to [`$env/dynamic/private`](https://kit.svelte.dev/docs/modules#$env-dynamic-private), but only includes variables that begin with [`config.kit.env.publicPrefix`](https://kit.svelte.dev/docs/configuration#env) (which defaults to `PUBLIC_`), and can therefore safely be exposed to client-side code.
 * 
 * Note that public dynamic environment variables must all be sent from the server to the client, causing larger network requests — when possible, use `$env/static/public` instead.
 * 
 * Dynamic environment variables cannot be used during prerendering.
 * 
 * ```ts
 * import { env } from '$env/dynamic/public';
 * console.log(env.PUBLIC_DEPLOYMENT_SPECIFIC_VARIABLE);
 * ```
 */
declare module '$env/dynamic/public' {
	export const env: {
		[key: `PUBLIC_${string}`]: string | undefined;
	}
}
