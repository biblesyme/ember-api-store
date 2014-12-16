import Ember from 'ember';
import Serializable from './serializable';

var Type = Ember.Mixin.create(Serializable,{
  id: null,
  type: null,
  links: null,
  actions: null,

  toString: function() {
    return '(generic type mixin)';
  },

  // unionArrays=true will append the new values to the existing ones instead of overwriting.
  merge: function(newData, unionArrays) {
    var self = this;
    newData.eachKeys(function(v, k) {
      if ( newData.hasOwnProperty(k) )
      {
        var curVal = self.get(k);
        if ( unionArrays && Ember.isArray(curVal) && Ember.isArray(v) )
        {
          curVal.pushObjects(v);
        }
        else
        {
          self.set(k, v);
        }
      }
    });

    return self;
  },

  replaceWith: function(newData) {
    var self = this;
    // Add/replace values that are in newData
    newData.eachKeys(function(v, k) {
      self.set(k, v);
    });

    // Remove values that are in current but not new.
    var newKeys = newData.allKeys();
    this.eachKeys(function(v, k) {
      // If the key is a valid link name and 
      if ( newKeys.indexOf(k) === -1 && !this.hasLink(k) )
      {
        self.set(k, undefined);
      }
    });

    return self;
  },

  clone: function() {
    var output = this.constructor.create(this.serialize());
    //output.set('store', this.get('store'));
    return output;
  },

  linkFor: function(name) {
    var url = this.get('links.'+name);
    return url;
  },

  hasLink: function(name) {
    return !!this.linkFor(name);
  },

  followLink: function(name, opt) {
    var url = this.get('links.'+name);
    opt = opt || {};

    if (!url)
    {
      throw new Error('Unknown link');
    }

    if ( opt.include )
    {
      if ( !Ember.isArray(opt.include) )
      {
        opt.include = [opt.include];
      }

      opt.include.forEach(function(key) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'include=' + encodeURIComponent(key);
      });
    }

    return this.get('store').request({
      method: 'GET',
      url: url
    });
  },

  importLink: function(name, opt) {
    var self = this;
    opt = opt || {};

    return new Ember.RSVP.Promise(function(resolve,reject) {
      self.followLink(name, opt).then(function(data) {
        self.set(opt.as||name,data);
        resolve(self);
      }).catch(function(err) {
        reject(err);
      });
    },'Import Link: '+name);
  },

  hasAction: function(name) {
    var url = this.get('actions.'+name);
    return !!url;
  },

  computedHasAction: function(name) {
    return Ember.computed('actions.'+name, function() {
      return this.hasAction(name);
    });
  },

  doAction: function(name, data) {
    var url = this.get('actions.'+name);
    if (!url)
    {
      return Ember.RSVP.reject(new Error('Unknown action: ' + name));
    }

    return this.get('store').request({
      method: 'POST',
      url: url,
      data: data
    }).then(function(newData) {
      // newData may or may not be this same object, depending on what the action returns.
      return newData;
    });
  },

  save: function() {
    var self = this;
    var store = this.get('store');


    var method, url;
    var id = this.get('id');
    var type = store.normalizeType(this.get('type'));
    if ( id )
    {
      // Update
      method = 'PUT';
      url = this.get('links.self');
    }
    else
    {
      // Create
      if ( !type )
      {
        return Ember.RSVP.reject(new Error('Cannot create record without a type'));
      }

      method = 'POST';
      url = type;
    }

    var json = this.serialize();
    delete json['links'];
    delete json['actions'];

    return store.request({
      method: method,
      url: url,
      data: json,
    }).then(function(newData) {
      if ( !newData || !Type.detect(newData) )
      {
        return newData;
      }

      var newId = newData.get('id');
      var newType = store.normalizeType(newData.get('type'));
      if ( !id && newId && type === newType )
      {
        Ember.beginPropertyChanges();
        // A new record was created.  Typeify will have put it into the store,
        // but it's not the same instance as this object.  So we need to fix that.
        self.merge(newData);
        var existing = store.getById(type,newId);
        if ( existing )
        {
          store._remove(type, existing);
        }
        store._add(type, self);
        Ember.endPropertyChanges();
      }

      return self;
    });
  },

  delete: function() {
    var self = this;
    var store = this.get('store');
    var type = this.get('type');

    return this.get('store').request({
      method: 'DELETE',
      url: this.get('links.self')
    }).then(function(newData) {
      if ( store.get('removeAfterDelete') )
      {
        store._remove(type, self);
      }
      return newData;
    });
  }
});

export default Type;
