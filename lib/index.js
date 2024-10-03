import { exec as exec_origin } from 'child_process';
import util from 'util';
import { basename, dirname, join, resolve } from 'path';
import { copyFile, writeFile, rm, mkdir } from 'fs/promises';
import debug from 'debug';
import { fileURLToPath } from 'url';
import { is_directory_exists, is_file_exists, spinner_log, get_node_executable } from "./utils.js";
import ora from 'ora';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = debug('sea');

// promisify exec, let exec block until the process exits
const exec = util.promisify(exec_origin);


/**
 * Create single executable application (SEA) from entry script
 * See also https://nodejs.org/api/single-executable-applications.html
 * @param {string} script_entry_path
 * @param {string} executable_path
 * @param {{disableExperimentalSEAWarning?: boolean, useSnapshot?: boolean, useCodeCache?: boolean, useSystemNode?: boolean, nodeVersion?: string, withIntl?: string, arch?: string}} options
 */
export default async function sea(
  script_entry_path,
  executable_path,
  options = {}) {

  // CHANGE ADD DEFAULTS
  // CHANGE ADD platform
  const {
    disableExperimentalSEAWarning = true,
    useSnapshot = false,
    useCodeCache = false,
    useSystemNode = true,
    nodeVersion = 'v20.11.0',
    withIntl = 'small-icu',
    arch = 'x64',
    platform = process.platform,
  } = options;

  // normalize the script_entry_path and executable_path
  script_entry_path = resolve(process.cwd(), script_entry_path);
  executable_path = resolve(process.cwd(), executable_path);
  // check if script_entry_path exists and is a file
  if (!await is_file_exists(script_entry_path)) {
    throw new Error(`Script entry path ${script_entry_path} does not exist`);
  }
  // check if executable directory exists
  if (!await is_directory_exists(dirname(executable_path))) {
    throw new Error(`Executable directory ${dirname(executable_path)} does not exist`);
  }
  // check if executable_path exists
  if (await is_file_exists(executable_path)) {
    console.warn(`Executable path ${executable_path} already exists, will be overwritten`);
  }
  // check node version, needs to be at least 20.0.0
  if (process.version < 'v20.0.0') {
    throw new Error(`System Node version ${process.version} is too old, needs to be at least v20.0.0`);
  }
  // get the node executable
  const node_executable = await get_node_executable({ useSystemNode, nodeVersion, withIntl, arch, platform });
  // copy the executable as the output executable
  await copyFile(node_executable, executable_path);
  // create a temporary directory for the processing work
  const temp_dir = join(__dirname, '../.temp');
  // create the temporary directory if it does not exist
  // TODO mkdir recurseive
  if (!await is_directory_exists(temp_dir)) {
    await mkdir(temp_dir);
  }
  // change working directory to temp_dir
  // process.chdir(temp_dir);
  // Create a configuration file building a blob that can be injected into the single executable application
  const preparation_blob_path = join(temp_dir, 'sea-prep.blob');
  const sea_config_path = join(temp_dir, 'sea-config.json');
  const sea_config = {
    main: script_entry_path,
    output: preparation_blob_path,
    disableExperimentalSEAWarning,
    useSnapshot,
    useCodeCache,
  }
  await spinner_log(`Writing configuration file into ${sea_config_path}`, async () => {
    await writeFile(sea_config_path, JSON.stringify(sea_config));
  });
  // Generate the blob to be injected
  await spinner_log(`Generating blob into ${preparation_blob_path}`, async () => {
    await exec(`node --experimental-sea-config "${sea_config_path}"`);
  });
  // Inject the blob into the copied binary by running postject
  await spinner_log(`Injecting blob into ${basename(executable_path)}`, async () => {
    await exec(`npx postject "${executable_path}" NODE_SEA_BLOB "${preparation_blob_path}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`);
  });
  // Remove the temporary directory
  await spinner_log(`Removing all the files in temporary directory ${temp_dir}`, async () => {
    await rm(temp_dir, { recursive: true });
  });
  ora(`All done!`).succeed();
}
