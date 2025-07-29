// test/rules-sample.js
// Export rules as CommonJS (for Node require compatibility)
module.exports = [
  {
    regex: /TODO/,
    message: 'Found TODO: {line}',
    paths: [/\.js$/]
  },
  {
    regex: /console\.log/,
    level: 'error',
    message: 'Avoid console.log usage on commited code'
  }
]
