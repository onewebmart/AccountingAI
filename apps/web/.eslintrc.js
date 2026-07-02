module.exports = {
  extends: ['next/core-web-vitals', '../../.eslintrc.js'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
