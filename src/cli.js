#!/usr/bin/env node
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resolvedHostApp =
  typeof process.env.MODEL_CLI_HOST_APP === 'string' ? process.env.MODEL_CLI_HOST_APP.trim() : '';
if (!resolvedHostApp) {
  process.env.MODEL_CLI_HOST_APP = 'aide';
}
const resolvedConfigHostApp =
  typeof process.env.MODEL_CLI_CONFIG_HOST_APP === 'string'
    ? process.env.MODEL_CLI_CONFIG_HOST_APP.trim()
    : '';
if (!resolvedConfigHostApp) {
  process.env.MODEL_CLI_CONFIG_HOST_APP = 'chatos';
}

const entryPath = path.resolve(__dirname, '..', 'cli', 'src', 'index.js');
await import(pathToFileURL(entryPath).href);
