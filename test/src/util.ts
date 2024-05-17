/*
 * Copyright 2024 Holger Dal Mogensen
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as path from 'path'
import * as vscode from 'vscode'

/**
 * Activates the extension and copies the contents of the given test workspace directory into the extive workspace.
 *
 * @param testWorkspaceName The name of the workspace directory to copy, e.g. `codeActions`.
 */
export async function activate(testWorkspaceName: string) {
  // The extensionId is `publisher.name` from package.json
  const ext = vscode.extensions.getExtension('flix.flix')
  if (ext === undefined) {
    throw new Error('Failed to activate extension')
  }

  await copyWorkspace(testWorkspaceName)

  // This includes the time it takes for the compiler to download
  // The time it takes for the compiler to start will be awaited in the first command sent to the extension
  await ext.activate()
}

/**
 * Clears the test workspace, and copies the contents of the given test workspace directory into the active workspace.
 *
 * @param testWorkspaceName The name of the workspace directory to copy, e.g. `codeActions`.
 */
async function copyWorkspace(testWorkspaceName: string) {
  vscode.commands.executeCommand('workbench.action.closeAllEditors')

  const activeWorkspaceUri = vscode.workspace.workspaceFolders![0].uri

  /** Recursively clears all safe files from the given directory. */
  async function clearDir(uri: vscode.Uri) {
    const contents = await vscode.workspace.fs.readDirectory(uri)

    // Recurse into subdirectories
    const dirs = contents.filter(([_, type]) => type === vscode.FileType.Directory)
    const dirUris = dirs.map(([name, _]) => vscode.Uri.joinPath(uri, name))
    await Promise.allSettled(dirUris.map(clearDir))

    const files = contents.filter(([_, type]) => type !== vscode.FileType.Directory)
    const fileNames = files.map(([name, _]) => name)

    // Delete all files except .gitkeep and flix.jar
    const namesToKeep = ['.gitkeep', 'flix.jar']

    // Be careful, and only delete files with known extensions
    const extensionsToDelete = ['flix', 'toml', 'jar', 'fpkg', 'txt']

    const namesToDelete = fileNames.filter(
      name => !namesToKeep.includes(name) && extensionsToDelete.includes(name.split('.').at(-1)),
    )
    const urisToDelete = namesToDelete.map(name => vscode.Uri.joinPath(uri, name))
    await Promise.allSettled(urisToDelete.map(deleteFile))
  }
  await clearDir(activeWorkspaceUri)

  const testWorkspacePath = path.resolve(__dirname, '../testWorkspaces', testWorkspaceName)
  await copyDirContents(vscode.Uri.file(testWorkspacePath), activeWorkspaceUri)
}

/**
 * Opens the document at `docUri` in the main editor.
 */
export async function open(docUri: vscode.Uri) {
  const doc = await vscode.workspace.openTextDocument(docUri)
  await vscode.window.showTextDocument(doc)
}

/**
 * Types the given `text` in the editor at the current position.
 */
export async function typeText(text: string) {
  await vscode.commands.executeCommand('type', { text })
}

function getTestDocPath(p: string) {
  return path.resolve(__dirname, '../activeWorkspace', p)
}
export function getTestDocUri(p: string) {
  return vscode.Uri.file(getTestDocPath(p))
}

/**
 * Sleeps for `ms` milliseconds.
 */
export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Waits for the processing of a newly added or deleted file to finish.
 */
async function processFileChange() {
  // Wait for the file system watcher to pick up the change
  await sleep(1000)

  try {
    // Wait for the compiler to process the change
    await vscode.commands.executeCommand('flix.allJobsFinished')
  } catch {
    // Compiler is not running
  }

  // Wait for the diagnostics to be updated
  await sleep(1000)
}

/**
 * Add a file with the given `uri` and `content`, and wait for the compiler to process this.
 */
export async function addFile(uri: vscode.Uri, content: string | Uint8Array) {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content))
  await processFileChange()
}

/**
 * Copies the contents of the given folder `from` to the folder `to`, leaving non-overlapping files intact.
 */
export async function copyDirContents(from: vscode.Uri, to: vscode.Uri) {
  const contents = await vscode.workspace.fs.readDirectory(from)
  const names = contents.map(([name, _]) => name)

  const uris = names.map(name => ({ from: vscode.Uri.joinPath(from, name), to: vscode.Uri.joinPath(to, name) }))

  await Promise.allSettled(uris.map(({ from, to }) => copyFile(from, to)))
  await processFileChange()
}

/**
 * Copy the file from `from` to `to`, and wait for the compiler to process this.
 */
export async function copyFile(from: vscode.Uri, to: vscode.Uri) {
  await vscode.workspace.fs.copy(from, to, { overwrite: true })
  await processFileChange()
}

/**
 * Delete the file at `uri`, and wait for the compiler to process this.
 *
 * Throws if the file does not exist.
 */
export async function deleteFile(uri: vscode.Uri) {
  await vscode.workspace.fs.delete(uri)
  await processFileChange()
}

/**
 * Tries to delete the file at `uri`, but does nothing if the file does not exist.
 */
export async function tryDeleteFile(uri: vscode.Uri) {
  try {
    await deleteFile(uri)
  } catch {
    // File does not exist - no need to delete
  }
}
