# [1.6.0](https://github.com/BuilderIO/gpt-crawler/compare/v1.5.1...v1.6.0) (2024-10-22)

### Features

- add named crawl configurations with `crawlConfigurations` array ([config.ts](config.ts))
- add `getConfigurationByName()` helper function for configuration lookup ([config.ts](config.ts))
- improve containerapp with clearer documentation and simplified init script ([containerapp/data/init.sh](containerapp/data/init.sh))

### Security

- add security warnings for Docker-in-Docker configuration in containerapp ([containerapp/README.md](containerapp/README.md))

### BREAKING CHANGES

- Switch from npm to Bun package manager (removed package-lock.json, added bun.lock)
- Config structure enhanced with named configurations

### Chore

- remove GitHub Actions workflows (pr.yml and release.yml)
- normalize line endings across multiple files (CRLF → LF)
- remove sudo requirements from containerapp/run.sh script

## [1.5.1](https://github.com/BuilderIO/gpt-crawler/compare/v1.5.0...v1.5.1) (2024-01-23)

### Bug Fixes

- correctly set cookies ([567ab0b](https://github.com/BuilderIO/gpt-crawler/commit/567ab0b0a538032d02743ae3ecc51dfdc0fdb5c6))

# [1.5.0](https://github.com/BuilderIO/gpt-crawler/compare/v1.4.0...v1.5.0) (2024-07-05)

### Features

- git clone depth limit in docker ([87767db](https://github.com/BuilderIO/gpt-crawler/commit/87767dbda99b3259d44ec2c02dceb3a59bb2ca3c))

# [1.4.0](https://github.com/BuilderIO/gpt-crawler/compare/v1.3.0...v1.4.0) (2024-01-15)

### Bug Fixes

- linting ([0f4e58b](https://github.com/BuilderIO/gpt-crawler/commit/0f4e58b400eab312e7b595d7a2472bae93055415))

### Features

- add server api readme docs ([717e625](https://github.com/BuilderIO/gpt-crawler/commit/717e625f47257bdbd96437acb7242bcd28c233ba))

# [1.3.0](https://github.com/BuilderIO/gpt-crawler/compare/v1.2.1...v1.3.0) (2024-01-06)

### Features

- add exclude pattern for links in config ([16443ed](https://github.com/BuilderIO/gpt-crawler/commit/16443ed9501624de40d921b8e47e4c35f15bf6b4))
