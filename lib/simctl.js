import { exec, SubProcess } from 'teen_process';
import { retryInterval } from 'asyncbox';
import { logger, fs, tempDir } from 'appium-support';
import _ from 'lodash';


const log = logger.getLogger('simctl');

async function simCommand (command:string, timeout:number, args:Array = [], env = {}, executingFunction = exec, logErrors = true) {
  // run a particular simctl command
  args = [command, ...args];
  // Prefix all passed in environment variables with 'SIMCTL_CHILD_', simctl
  // will then pass these to the child (spawned) process.
  env = _.defaults(_.mapKeys(env, (value, key) => {
    return `SIMCTL_CHILD_${key}`;
  }), process.env);

  try {
    return await executingFunction('fbsimctl', args, {timeout, env});
  } catch (e) {
    if (!logErrors) {
      // if we don't want to see the errors, just throw and allow the calling
      // code do what it wants
      throw e;
    } else if (e.stderr) {
      log.errorAndThrow(`simctl error running '${command}': ${e.stderr.trim()}`);
    } else {
      log.errorAndThrow(e);
    }
  }
}

async function simExec (command:string, timeout:number, args:Array = [], env = {}, logErrors = true) {
  return await simCommand(command, timeout, args, env async (c, a, o,b) => {
    return await exec(c, a, ob);
  }, logErrors);
}

async function simSubProcess (command:string, timeout:number, args:Array = [], env = {}) {
  return await simCommand(command, timeout, args, env, async (c, a, ob) => {
    return new SubProcess(c, a, ob);
  });
}
async function installApp (udid:string, appPath:string):void {
  await simExec(udid, 0, ['install', appPath]);
}

async function removeApp (udid:string, bundleId:string):void {
  await simExec(udid, 0, ['uninstall', bundleId]);
}

async function launch (udid:string, bundleId:string, tries:int = 5):void {
  await retryInterval(tries, 1000, async () => {
    await simExec(udid, 0, ['lauch', bundleId]);
  });
}

async function spawn (udid:string, executablePath:string, env = {}):void {
  return await simExec('spawn', 0, [udid, executablePath], env);
}

async function spawnSubProcess (udid:string, executablePath:string, env = {}):void {
  return await simSubProcess('spawn', 0, [udid, executablePath], env);
}

async function openUrl (udid:string, url:string):void {
  return await simExec('openurl', 0, [udid, url]);
}

async function terminate (udid:string, bundleId:string):void {
  await simExec('terminate', 0, [udid, bundleId]);
}

async function getAppContainer (udid:string, bundleId:string, logErrors = true) {
  let {stdout} = await simExec('get_app_container', 0, [udid, bundleId], {}, logErrors);
  return (stdout || '').trim();
}

async function shutdown (udid:string):void {
  await simExec('shutdown', 0, [udid]);
}

async function createDevice (deviceTypeId:string,
    runtimeId:string, timeout:int = 10000):void {
  let udid;
  try {
    const out = await simExec('create', 0, [deviceTypeId, runtimeId]);
    const finalLine = _.last(out.stdout.trim().split('\n')).replace('Create Ended: ', '');
    udid = finalLine.split('|')[0].trim();
  } catch (e) {
    if (e.stderr) {
      log.errorAndThrow(`Could not create simulator. Reason: ${e.stderr.trim()}`);
    } else {
      log.errorAndThrow(new Error(`Error creating device type: ${deviceTypeId} - Exception: `,
        deviceTypeId,
        e
      ));
    }

  }


async function deleteDevice (udid:string):void {
  await simExec('delete', 0, [udid]);
}

async function eraseDevice (udid:string, timeout:int = 1000):void {
  let loopFn:Function = async () => {
    await simExec('erase', 10000, [udid]);
  };
  // retry erase with a sleep in between because it's flakey
  let retries = parseInt(timeout / 200, 10);
  await retryInterval(retries, 200, loopFn);
}

async function getDevicesByParsing ():Object {
  // get the list of devices
  let {stdout} = await simExec('list', 0, ['devices']);

  // expect to get a listing like
  // -- iOS 8.1 --
  //     iPhone 4s (3CA6E7DD-220E-45E5-B716-1E992B3A429C) (Shutdown)
  //     ...
  // -- iOS 8.2 --
  //     iPhone 4s (A99FFFC3-8E19-4DCF-B585-7D9D46B4C16E) (Shutdown)
  //     ...
  // so, get the `-- iOS X.X --` line to find the sdk (X.X)
  // and the rest of the listing in order to later find the devices
  let deviceSectionRe:RegExp = /-- iOS (.+) --(\n\s{4}.+)*/mg;
  let matches:Array = [];
  let match:Object = deviceSectionRe.exec(stdout);

  // make an entry for each sdk version
  while (match !== null) {
    matches.push(match);
    match = deviceSectionRe.exec(stdout);
  }
  if (matches.length < 1) {
    log.errorAndThrow('Could not find device section');
  }

  // get all the devices for each sdk
  let devices:Object = {};
  for (match of matches) {
    let sdk:string = match[1];
    devices[sdk] = [];
    // split the full match into lines and remove the first
    for (let line:string of match[0].split('\n').slice(1)) {
      // a line is something like
      //    iPhone 4s (A99FFFC3-8E19-4DCF-B585-7D9D46B4C16E) (Shutdown)
      // retrieve:
      //   iPhone 4s
      //   A99FFFC3-8E19-4DCF-B585-7D9D46B4C16E
      //   Shutdown
      let lineRe:RegExp = /([^\s].+) \((\w+-.+\w+)\) \((\w+\s?\w+)\)/; // https://regex101.com/r/lG7mK6/3
      let lineMatch:Object = lineRe.exec(line);
      if (lineMatch === null) {
        throw new Error(`Could not match line: ${line}`);
      }
      // save the whole thing as ab object in the list for this sdk

      devices[sdk].push({
        name: lineMatch[1],
        udid: lineMatch[2],
        state: lineMatch[3],
        sdk,
      });
    }
  }

  return devices;
}

async function getRuntimeID(sdkName:string):string {
  let rant;
  let {stdout} = await simExec('list', 0, ['-j']);
  let runtimes = JSON.parse(stdout).runtimes;
  for(let runtime of runtimes){
    if(item.name.indexOf("iOS 10.2") > -1){
        rant = item.identifier
    }
  }
  return rant;
}


async function getDevices (forSdk:string = null):Object {
  // get the list of devices
  const {stdout} = await simExec('list', 0);
  const devices:Object = {};
  const items = stdout.split('\n');
  for (const item of items) {
    const itemSegments = item.split('|').map((x) => x.trim());
    const sdk = itemSegments[4];
    devices[sdk] = devices[sdk] || [];
    devices[sdk].push({
      udid: itemSegments[0],
      name: itemSegments[1],  // 1 or 3? Seems either suits in fbsimctl 
      state: itemSegments[2], // since names arent customizable.
    });
  } 

  // if a `forSdk` was passed in, return only the corresponding list
  if (forSdk) {
    if (!devices[forSdk]) {
      throw new Error(`Sdk '${forSdk}' was not in list of simctl sdks`);
    }
    return devices[forSdk];
  }

  // otherwise return all the sdk -> device mappings.
  console.log(devices)
  return devices;
}
/**
 * Gets base64 screenshot for device (xcode >= 8.1 only)
 * @param {string} udid 
 */
async function getScreenshot (udid:string):string {
  let pathToScreenshotPng = await tempDir.path({prefix: `screenshot-${udid}`, suffix: '.png'});
  await simExec('io', 0, [udid, 'screenshot', pathToScreenshotPng]);
  let screenshotImg = await fs.readFile(pathToScreenshotPng);
  await fs.rimraf(pathToScreenshotPng);
  return screenshotImg.toString('base64');
}

export { installApp, removeApp, launch, spawn, spawnSubProcess, openUrl, terminate, shutdown, createDevice,
         getAppContainer, getScreenshot, deleteDevice, eraseDevice, getDevices, simCommand, simExec, getRuntimeID };
