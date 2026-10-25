import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',fullyParallel:false,workers:1,reporter:'list',
 use:{headless:true,launchOptions:process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{},trace:'retain-on-failure'},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['iPhone 13'],defaultBrowserType:'chromium'}}],
});
