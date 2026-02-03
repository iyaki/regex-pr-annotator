// Sample rules file for regex-pr-annotator
// This file can be used as a template or referenced in GitHub Actions
export default [
  {
    regex: /TODO/,
    message: 'Found TODO: {line}',
    paths: [/\.js$/]
  },
  {
    regex: /console\.log/,
    level: 'error',
    message: 'Avoid console.log usage on committed code'
  }
]
