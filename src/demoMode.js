'use strict'

const fs = require('fs')
const path = require('path')

const MARKER_FILE = 'demo-mode-active'

// Demo mode is on when a file named demo-mode-active exists in the plugin data
// directory. Only its presence counts; nothing is read from it, and a directory
// of that name does not count.
function isDemoMode (dataDir) {
  try {
    return fs.statSync(path.join(dataDir, MARKER_FILE)).isFile()
  } catch (e) {
    return false
  }
}

module.exports = { MARKER_FILE, isDemoMode }
