import Ember from 'ember';
import Serializable from '../mixins/serializable';
import ApiError from '../models/error';
import { normalizeType } from '../utils/normalize';
import { applyHeaders } from '../utils/apply-headers';
<<<<<<< HEAD
import { urlOptions } from './utils/url-options';
import fetch from 'ember-api-store/utils/fetch';
import { urlOptions } from './utils/url-options';
=======
import { fetch } from 'ember-api-store/utils/fetch';
import { urlOptions } from '../utils/url-options';
>>>>>>> v2/fastboot tweaks

const { getOwner } = Ember;

export const defaultMetaKeys = ['actions','createDefaults','createTypes','filters','links','pagination','resourceType','sort','sortLinks','type'];
export const defaultSkipTypeifyKeys = [];

var Store = Ember.Service.extend({
  cookie: Ember.inject.service(),

  defaultTimeout: 30000,
  defaultPageSize: 1000,
  baseUrl: '/v1',
  metaKeys: null,
  skipTypeifyKeys: null,
  replaceActions: 'actionLinks',
  shoeboxName: 'ember-api-store',
  headers: null,

  arrayProxyClass: Ember.ArrayProxy,
  arrayProxyKey: 'content',

  // true: automatically remove from store after a record.delete() succeeds.  You might want to disable this if your API has a multi-step deleted vs purged state.
  removeAfterDelete: true,


  fastboot: Ember.computed(function() {
    return Ember.getOwner(this).lookup('service:fastboot');
  }),

  init() {
    this._super();

    if (!this.get('metaKeys') )
    {
      this.set('metaKeys', defaultMetaKeys.slice());
    }

    if (!this.get('skipTypeifyKeys') )
    {
      this.set('skipTypeifyKeys', defaultSkipTypeifyKeys.slice());
    }

    this._state = {
      cache: null,
      foundAll: null,
      findQueue: null,
    };

    let fastboot = this.get('fastboot');
    if ( fastboot )
    {
      let name = this.get('shoeboxName');
      if ( fastboot.get('isFastBoot') )
      {
        fastboot.get('shoebox').put(name, this._state);
      }
      else
      {
        let box = fastboot.get('shoebox').retrieve(name);
        if ( box )
        {
          this._state = box;
        }
      }
    }

    this.reset();
  },

  // All the saved state goes in here
  _state: null,

  // You can observe this to tell when a reset() happens
  generation: 0,

  // Synchronously get record from local cache by [type] and [id].
  // Returns undefined if the record is not in cache, does not talk to API.
  getById(type, id) {
    type = normalizeType(type);
    var group = this._group(type);
    return group.filterBy('id',id)[0];
  },

  // Synchronously returns whether record for [type] and [id] is in the local cache.
  hasRecordFor(type, id) {
    return !!this.getById(type,id);
  },

  // Synchronously returns whether this exact record object is in the local cache
  hasRecord(obj) {
    var type = normalizeType(obj.get('type'));
    var group = this._group(type);
    return group.indexOf(obj) >= 0;
  },

  isCacheable(opt) {
    return !opt || (opt.depaginate && !opt.filter && !opt.include);
  },

  // Asynchronous, returns promise.
  // find(type[,null, opt]): Query API for all records of [type]
  // find(type,id[,opt]): Query API for record [id] of [type]
  // opt:
  //  filter: Filter by fields, e.g. {field: value, anotherField: anotherValue} (default: none)
  //  include: Include link information, e.g. ['link', 'anotherLink'] (default: none)
  //  forceReload: Ask the server even if the type+id is already in cache. (default: false)
  //  limit: Number of reqords to return per page (default: 1000)
  //  depaginate: If the response is paginated, retrieve all the pages. (default: true)
  //  headers: Headers to send in the request (default: none).  Also includes ones specified in the model constructor.
  //  url: Use this specific URL instead of looking up the URL for the type/id.  This should only be used for bootstraping schemas on startup.
  find(type, id, opt) {
    type = normalizeType(type);
    opt = opt || {};
    opt.depaginate = opt.depaginate !== false;

    if ( !id && !opt.limit )
    {
      opt.limit = this.defaultPageSize;
    }

    if ( !type )
    {
      return Ember.RSVP.reject(new ApiError('type not specified'));
    }

    // If this is a request for all of the items of [type], then we'll remember that and not ask again for a subsequent request
    var isCacheable = this.isCacheable(opt);
    var isForAll = !id && isCacheable;

    // See if we already have this resource, unless forceReload is on.
    if ( opt.forceReload !== true )
    {
      if ( isForAll && this._state.foundAll[type] )
      {
        return Ember.RSVP.resolve(this.all(type),'Cached find all '+type);
      }
      else if ( isCacheable && id )
      {
        var existing = this.getById(type,id);
        if ( existing )
        {
          return Ember.RSVP.resolve(existing,'Cached find '+type+':'+id);
        }
      }
    }

    // If URL is explicitly given, go straight to making the request.  Do not pass go, do not collect $200.
    // This is used for bootstraping to load the schema initially, and shouldn't be used for much else.
    if ( opt.url )
    {
      return this._findWithUrl(opt.url, type, opt);
    }
    else
    {
      // Otherwise lookup the schema for the type and generate the URL based on it.
      return this.find('schema', type, {url: 'schemas/'+encodeURIComponent(type)}).then((schema) => {
        var url = schema.linkFor('collection') + (id ? '/'+encodeURIComponent(id) : '');
        return this._findWithUrl(url, type, opt);
      });
    }
  },

  // Returns a 'live' array of all records of [type] in the cache.
  all(type) {
    type = normalizeType(type);
    var group = this._group(type);
    var proxy = this.arrayProxyClass.create({
      [this.arrayProxyKey]: group
    });

    return proxy;
  },

  haveAll(type) {
    type = normalizeType(type);
    return this._state.foundAll[type];
  },

  // find(type) && return all(type)
  findAll(type) {
    type = normalizeType(type);

    if ( this.haveAll(type) )
    {
      return Ember.RSVP.resolve(this.all(type),'All '+ type + ' already cached');
    }
    else
    {
      return this.find(type).then(() => {
        return this.all(type);
      });
    }
  },

  normalizeUrl(url, includingAbsolute=false) {
    var origin = window.location.origin;

    // Make absolute URLs to ourselves root-relative
    if ( includingAbsolute && url.indexOf(origin) === 0 )
    {
      url = url.substr(origin.length);
    }

    // Make relative URLs root-relative
    if ( !url.match(/^https?:/) && url.indexOf('/') !== 0 )
    {
      url = this.get('baseUrl').replace(/\/\+$/,'') + '/' + url;
    }

    return url;
  },

  // Makes an AJAX request and returns a promise that resolves to an object with xhr, textStatus, and [err]
  // This is separate from request() so it can be mocked for tests, or if you just want a basic AJAX request.
  rawRequest(opt) {
    opt.url = this.normalizeUrl(opt.url);
    opt.headers = this._headers(opt.headers);
    opt.processData = false;
    if ( typeof opt.dataType === 'undefined' )
    {
      opt.dataType = 'text'; // Don't let jQuery JSON parse
    }

    if ( opt.timeout !== null && !opt.timeout )
    {
      opt.timeout = this.defaultTimeout;
    }

    if ( opt.data )
    {
      if ( !opt.contentType )
      {
        opt.contentType = 'application/json';
      }

      if ( Serializable.detect(opt.data) )
      {
        opt.data = JSON.stringify(opt.data.serialize());
      }
      else if ( typeof opt.data === 'object' )
      {
        opt.data = JSON.stringify(opt.data);
      }
    }

    return fetch(opt.url, opt);
  },

  // Makes an AJAX request that resolves to a resource model
  request(opt) {
    var self = this;
    opt.url = this.normalizeUrl(opt.url);
    opt.depaginate = opt.depaginate !== false;
    var boundTypeify = this._typeify.bind(this);

    if ( this.mungeRequest ) {
      opt = this.mungeRequest(opt);
    }

    var promise = new Ember.RSVP.Promise(function(resolve,reject) {
      self.rawRequest(opt).then(success,fail);

      function success(obj) {
        var xhr = obj.xhr;

        if ( xhr.status === 204 )
        {
          resolve();
        }
        else if ( (xhr.getResponseHeader('content-type')||'').toLowerCase().indexOf('/json') !== -1 )
        {
          var response = JSON.parse(xhr.responseText, boundTypeify);

          if ( opt.include && opt.include.length && response.forEach )
          {
            // Note which keys were included
            response.forEach((obj) => {
              obj.includedKeys = obj.includedKeys || [];
              obj.includedKeys.pushObjects(opt.include.slice());
              obj.includedKeys = obj.includedKeys.uniq();
            });
          }

          Object.defineProperty(response, 'xhr', { value: obj.xhr, configurable: true, writable: true});
          Object.defineProperty(response, 'textStatus', { value: obj.textStatus, configurable: true, writable: true});

          if ( opt.depaginate && typeof response.depaginate === 'function' )
          {
            response.depaginate().then(function() {
              resolve(response);
            }).catch(fail);
          }
          else
          {
            resolve(response);
          }
        }
        else
        {
          resolve(xhr.responseText);
        }
      }

      function fail(obj) {
        reject(self._requestFailed(obj,opt));
      }

    },'Request: '+ opt.url);

    return promise;
  },

  // Forget about all the resources that hae been previously remembered.
  reset() {
    var cache = this._state.cache;
    if ( cache )
    {
      Object.keys(cache).forEach((key) => {
        if ( cache[key] && cache[key].clear ) {
          cache[key].clear();
        }
      });
    }
    else
    {
      this._state.cache = {};
    }

    var foundAll = this._state.foundAll;
    if ( foundAll )
    {
      Object.keys(foundAll).forEach((key) => {
        foundAll[key] = false;
      });
    }
    else
    {
      this._state.foundAll = {};
    }

    this._state.findQueue = {};
    this.incrementProperty('generation');
  },

  resetType(type) {
    type = normalizeType(type);
    var group = this._group(type);
    this._state.foundAll[type] = false;
    group.clear();
  },

  // ---------
  // Below here be dragons
  // ---------
  _headers(perRequest) {
    let out = {
      'accept': 'application/json',
    };

    applyHeaders(this.get('headers'), out);
    applyHeaders(perRequest, out);
    return out;
  },

  _findWithUrl(url, type, opt) {
    var queue = this._state.findQueue;
    var cls = getOwner(this).lookup('model:'+type);
    url = urlOptions(url,opt,cls);

    // Collect Headers
    var newHeaders = {};
    if ( cls && cls.constructor.headers )
    {
      applyHeaders(cls.constructor.headers, newHeaders, true);
    }
    applyHeaders(opt.headers, newHeaders, true);
    // End: Collect headers

    var later;
    var queueKey = JSON.stringify(newHeaders) + url;

    // check to see if the request is in the findQueue
    if (queue[queueKey]) {
      // get the filterd promise object
      var filteredPromise = queue[queueKey];
      let defer = Ember.RSVP.defer();
      filteredPromise.push(defer);
      later = defer.promise;

    } else { // request is not in the findQueue

      opt.url = url;
      opt.headers = newHeaders;

      later = this.request(opt).then((result) => {
        if ( isForAll ) {
          this._state.foundAll[type] = true;
        }

        this._finishFind(queueKey, result, 'resolve');
        return result;
      }, (reason) => {
        this._finishFind(queueKey, reason, 'reject');
        return Ember.RSVP.reject(reason);
      });

      // set the queue array to empty indicating we've had 1 promise already
      queue[queueKey] = [];
    }

    return later;

  },

  _finishFind(key, result, type) {
    var queue = this._state.findQueue;
    var promises = queue[key];

    if (promises) {
      while (promises.length) {
        if (type === 'resolve') {
          promises.pop().resolve(result);
        } else if (type === 'reject') {
          promises.pop().reject(result);
        }
      }
    }

    delete queue[key];
  },

  _requestFailed(obj,opt) {
    var response, body;
    var xhr = obj.xhr;
    var err = obj.err;
    var textStatus = obj.textStatus;

    if ( (xhr.getResponseHeader('content-type')||'').toLowerCase().indexOf('/json') !== -1 )
    {
      body = JSON.parse(xhr.responseText, this._typeify.bind(this));
    }
    else if ( err )
    {
      if ( err === 'timeout' )
      {
        body = {
          code: 'Timeout',
          status: xhr.status,
          message: `API request timeout (${opt.timeout/1000} sec)`,
          detail: (opt.method||'GET') + ' ' + opt.url,
        };
      }
      else
      {
        body = {status: xhr.status, message: err};
      }
    }
    else
    {
      body = {status: xhr.status, message: xhr.responseText};
    }

    if ( ApiError.detectInstance(body) )
    {
      response = body;
    }
    else
    {
      response = ApiError.create(body);
    }

    Object.defineProperty(response, 'xhr', { value: xhr, configurable: true, writable: true});
    Object.defineProperty(response, 'textStatus', { value: textStatus, configurable: true, writable: true});

    return response;
  },

  // Get the cache group for [type]
  _group(type) {
    type = normalizeType(type);
    var cache = this._state.cache;
    var group = cache[type];
    if ( !group )
    {
      group = [];
      cache[type] = group;
    }

    return group;
  },

  // Add a record instance of [type] to cache
  _add(type, obj) {
    type = normalizeType(type);
    var group = this._group(type);
    group.pushObject(obj);

    if ( obj.wasAdded && typeof obj.wasAdded === 'function' )
    {
      obj.wasAdded();
    }
  },

  // Add a lot of instances of the same type quickly.
  //   - There must be a model for the type already defined.
  //   - Instances cannot contain any nested other types (e.g. include or subtypes),
  //     (they will not be deserialzed into their correct type.)
  //   - wasAdded hooks are not called
  // Basically this is just for loading schemas faster.
  _bulkAdd(type, pojos) {
    type = normalizeType(type);
    var group = this._group(type);
    var cls = getOwner(this).lookup('model:'+type);
    group.pushObjects(pojos.map((input)=>  {

      // actions is very unhappy property name for Ember...
      if ( this.replaceActions && typeof input.actions !== 'undefined')
      {
        input[this.replaceActions] = input.actions;
        delete input.actions;
      }

      // Schemas are special
      if ( type === 'schema' ) {
        input._id = input.id;
        input.id = normalizeType(input.id);
      }

      input.store = this;
      return cls.constructor.create(input);
    }));
  },

  // Remove a record of [type] from cache, given the id or the record instance.
  _remove(type, obj) {
    type = normalizeType(type);
    var group = this._group(type);
    group.removeObject(obj);

    if ( obj.wasRemoved && typeof obj.wasRemoved === 'function' )
    {
      obj.wasRemoved();
    }
  },

  // JSON.parse() will call this for every key and value when parsing a JSON document.
  // It does a recursive descent so the deepest keys are processed first.
  // The value in the output for the key will be the value returned.
  // If no value is returned, the key will not be included in the output.
  _typeify(key, input) {
    if (  !input ||
          typeof input !== 'object' ||
          !input.type ||
          Ember.isArray(input) ||
          (!input.id && input.type !== 'collection') ||
          typeof input.type !== 'string' || 
          this.get('skipTypeifyKeys').indexOf(key) >= 0
       )
    {
      // Basic values can be returned unmodified
      return input;
    }

    // Actual resorces should be added or updated in the store
    // var output;
    var type = normalizeType(input.type);

    if ( type === 'collection')
    {
      return this.createCollection(input)
    }
    else if ( type && input.id )
    {
      var output = this.createRecord(input, type);

      var cacheEntry = this.getById(type, output.id);
      if ( cacheEntry )
      {
        cacheEntry.replaceWith(output);
        return cacheEntry;
      }
      else
      {
        this._add(type, output);
        return output;
      }
    }
    else
    {
      // This shouldn't happen...
      return input;
    }
  },

  // Create a collection
  createCollection(input, key='data') {
    var cls = getOwner(this).lookup('model:collection');
    var output = cls.constructor.create({
      content: input[key],
    });

    Object.defineProperty(output, 'store', { value: this, configurable: true});

    output.setProperties(Ember.getProperties(input, this.get('metaKeys')));
    return output;
  },

  // Create a record, but do not insert into the cache
  createRecord(data, type) {
    type = normalizeType(type||data.type||'');
    var cls, schema;

    if ( type )
    {
      cls = getOwner(this).lookup('model:'+type);
      schema = this.getById('schema',type);
    }

    if ( !cls )
    {
      cls = getOwner(this).lookup('model:resource');
    }

    var cons = cls.constructor;

    var input;
    if ( schema )
    {
      input = schema.getCreateDefaults(data);
    }
    else
    {
      input = data;
    }

    // actions is very unhappy property name for Ember...
    if ( input.actions )
    {
      input.actionLinks = input.actions;
      delete input.actions;
    }

    if ( cons.mangleIn && typeof cons.mangleIn === 'function' )
    {
      input = cons.mangleIn(input,this);
    }

    var output = cons.create(input);

    Object.defineProperty(output, 'store', { value: this, configurable: true});
    return output;
  },

});

export default Store;
