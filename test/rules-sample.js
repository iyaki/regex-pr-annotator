// test/rules-sample.js
export default [
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
