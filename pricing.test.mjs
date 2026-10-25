import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimate} from './public/pricing.js';
test('standard apartment quote',()=>assert.equal(estimate('home',70,'once'),126));
test('recurring discount and windows',()=>assert.equal(estimate('home',70,'weekly',true),153.4));
test('minimum price and additional service',()=>assert.equal(estimate('office',20,'weekly',true),100));
test('deep cleaning fortnightly quote',()=>assert.equal(estimate('deep',100,'fortnightly'),304));
test('reject invalid or unsupported inputs',()=>{for(const args of [['home',0,'once'],['home',1001,'once'],['home',NaN,'once'],['unknown',70,'once'],['home',70,'bad'],['home',20.5,'once']])assert.throws(()=>estimate(...args),RangeError);});
