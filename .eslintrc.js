module.exports = {
  extends: ['eslint:recommended', 'plugin:prettier/recommended'],
  env: {
    node: true,
    es6: true
  },
  parserOptions: {
    ecmaVersion: 2022
  },
  rules: {
    'no-var': 'error',
    'no-unused-vars': ['warn', { args: 'none' }]
  }
}
