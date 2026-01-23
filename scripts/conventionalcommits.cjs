const conventionalCommits = require('conventional-changelog-conventionalcommits')

module.exports = async (presetConfig = {}) => {
  const preset = await conventionalCommits.default(presetConfig)

  return {
    parserOpts: preset.parser,
    writerOpts: preset.writer
  }
}
