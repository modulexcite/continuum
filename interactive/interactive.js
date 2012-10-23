(function(global, Continuum, constants, utility, debug){
var inherit = utility.inherit,
    define = utility.define;

function _(s){
  return document.createElement(s);
}

var sides = { left: 0, top: 1, right: 2, bottom: 3 };

var vert = { near: 'top', far: 'bottom', size: 'height' },
    horz = { near: 'left', far: 'right', size: 'width' };



var eventOptions = { bubbles: true, cancelable: true };

function Component(tag){
  this.element = _(tag);
  this.classes = this.element.classList;
}

define(Component.prototype, {
  ns: 'ƒ'
});

define(Component.prototype, [
  function addClass(name){
    return this.classes.add(this.ns + name);
  },
  function removeClass(name){
    return this.classes.remove(this.ns + name);
  },
  function toggleClass(name){
    return this.classes.toggle(this.ns + name);
  },
  function hasClass(name){
    return this.classes.contains(this.ns + name);
  },
  function on(event, listener){
    define(listener, 'bound', listener.bind(this));
    this.element.addEventListener(event, listener.bound, false);
    return this;
  },
  function off(event, listener){
    this.element.removeEventListener(event, listener.bound, false);
    return this;
  },
  function once(event, listener){
    this.on(event, function once(e){
      this.off(event, once);
      return listener.apply(this, arguments);
    });
    return this;
  },
  function emit(event, data){
    if (typeof event === 'string') {
      event = new Event(event, eventOptions);
    }
    if (data) {
      for (var k in data) {
        event[k] = data[k];
      }
    }
    return this.element.dispatchEvent(event);
  },
  function append(subject){
    if (subject.element) {
      this.children || (this.children = []);
      this.children.push(subject);
      this.element.appendChild(subject.element);
    } else if (subject instanceof Element) {
      this.element.appendChild(subject);
    }
    return this;
  }
]);


function PanelOptions(o){
  o = Object(o);
  for (var k in this) {
    if (k in o) {
      this[k] = o[k];
    }
  }
}

PanelOptions.prototype = {
  anchor: 'top',
  orient: 'vertical',
  mainSize: 'auto',
  crossSize: 'auto',
  name: null,
  left: null,
  top: null,
  right: null,
  bottom: null,
  content: null,
};


function Panel(parent, options){
  Component.call(this, 'div');
  options = new PanelOptions(options);

  this.anchor = parent ? options.anchor : null;
  this.orient = options.orient;
  this.mainSize = options.mainSize;
  this.crossSize = options.crossSize;
  this.parent = null;
  for (var k in sides) {
    this[k] = null;
  }
  this.addClass('panel');
  this.addClass(options.orient);
  if (!parent) {
    this.addClass('root');
    if (this.orient === 'vertical') {
      this.mainCalcSize = document.body.offsetHeight;
      this.crossCalcSize = document.body.offsetWidth;
    } else {
      this.mainCalcSize = document.body.offsetWidth;
      this.crossCalcSize = document.body.offsetHeight;
    }
  }


  if (options.name) {
    this.name = options.name;
    this.element.id = options.name;
  }

  if (options.content) {
    this.content = options.content;
    this.element.appendChild(this.content.element ? this.content.element : this.content);
  } else {
    this.content = null;
  }

  if (parent) {
    parent.mount(this);
  } else {
    document.body.appendChild(this.element);
  }

  this.forEach(function(_, side){
    if (options[side]) {
      options[side].anchor = side;
      this.mount(new Panel(this, options[side]));
    }
  });
}

inherit(Panel, Component, [
  function mount(panel){
    if (panel.parent === this) {
      var side = this.find(panel);
      if (side) {
        if (side !== panel.mount) {
          panel.mount = side;
        }
        return;
      }
    } else if (panel.parent) {
      panel.parent.unmount(panel);
    }

    if (this[panel.anchor]) {
      throw new Error('Panel already has mount at '+panel.anchor+' anchor');
    }

    this[panel.anchor] = panel;
    panel.parent = this;
    this.element.appendChild(panel.element);
    panel.addClass(panel.anchor);
    this.readjust();
  },
  function readjust(){
    if (this.orient === 'vertical') {
      var main = vert, cross = horz;
    } else {
      var main = horz, cross = vert;
    }

    ['near', 'far'].forEach(function(axis, i, a){
      var panel = this[main[axis]];
      if (panel) {
        panel.mainCalcSize = panel.mainSize;
        if (panel.mainSize === 'auto') {
          var other = this[main[a[1 - i]]];
          if (other && other.mainSize === 'auto') {
            other.mainCalcSize = panel.mainCalcSize = this.mainCalcSize / 2 | 0;
          } else {
            panel.mainCalcSize = this.mainCalcSize - (other ? other.mainCalcSize : 0);
          }
        }
        panel.element.style[main.size] = panel.mainCalcSize + 'px';
        this[axis] = panel.mainCalcSize;
      } else {
        this[axis] = 0;
      }
    }, this);

    ['near', 'far'].forEach(function(axis, i, a){
      var panel = this[cross[axis]];
      if (panel) {
        panel.mainCalcSize = panel.mainSize;
        if (panel.mainSize === 'auto') {
          var other = this[cross[a[1 - i]]];
          if (other && other.mainSize === 'auto') {
            other.mainCalcSize = panel.mainCalcSize = this.crossCalcSize / 2 | 0;
          } else {
            panel.mainCalcSize = this.crossCalcSize - (other ? other.mainCalcSize : 0);
          }
        }
        panel.element.style[main.near] = this.near + 'px';
        panel.element.style[main.far] = this.far + 'px';
        panel.element.style[cross.size] = panel.mainCalcSize + 'px';
      }
    }, this);
  },
  function unmount(panel){
    var anchor = this.find(panel);
    if (anchor) {
      this[anchor] = null;
      this.element.removeChild(panel.element);
      panel.removeClass(anchor);
      return true;
    }
    return false;
  },
  function find(panel){
    if (this[panel.mount] === panel) {
      return panel.mount;
    }
    for (var k in sides) {
      if (this[k] === panel) {
        return k;
      }
    }
    return null;
  },
  function has(panel){
    if (this[panel.mount] === panel) {
      return true;
    }
    for (var k in sides) {
      if (this[k] === panel) {
        return true;
      }
    }
    return false;
  },
  function forEach(callback, context){
    context = context || this;
    for (var k in sides) {
      callback.call(context, this[k], k, this);
    }
    return this;
  },
]);





function InputBox(){
  Component.call(this, 'textarea');
  this.element.spellcheck = false;
  this.addClass('input');

  var keyboard = new Keyboard(this.element),
      self = this;

  this.reset();

  keyboard.on('Enter', 'activate', function(e){
    e.preventDefault();
    self.entry();
  });

  keyboard.on('Up', 'activate', function(e){
    e.preventDefault();
    self.previous();
  });

  keyboard.on('Down', 'activate', function(e){
    e.preventDefault();
    self.next();
  });
}

inherit(InputBox, Component, [
  function entry(){
    var value = this.element.value;
    this.element.value = '';
    if (this.index !== this.items.length) {
      this.items.splice(this.index, 0, value);
    } else {
      this.items.push(value);
    }
    this.index++;
    this.emit('entry', value);
    return this;
  },
  function reset(){
    this.items = [];
    this.index = 0;
    this.element.value = '';
    return this;
  },
  function last(){
    this.index = this.items.length;
    this.element.value = '';
    return this;
  },
  function previous(){
    if (this.items.length) {
      if (this.index === 0) {
        this.last();
      } else {
        this.set('previous', this.items[--this.index]);
      }
    }
    return this;
  },
  function next(){
    if (this.items.length) {
      if (this.index === this.items.length - 1) {
        this.last();
      } else {
        if (this.index === this.items.length) {
          this.index = -1
        }
        this.set('next', this.items[++this.index]);
      }
    }
    return this;
  },
  function set(reason, value){
    this.element.value = value;
    this.emit(reason, value);
    return this;
  },
  function emit(event, value){
    var self = this;
    if (typeof value === 'string')
      value = { value: value };

    setTimeout(function(){
      var evt = new Event(event, { bubbles: true });
      if (value) {
        for (var k in value) {
          evt[k] = value[k];
        }
      }
      self.element.dispatchEvent(evt);
    }, 1);
  }
]);


function Console(){
  Component.call(this, 'div');
  this.addClass('console');
}

inherit(Console, Component, [
  function clear(){
    this.element.innerHTML = '';
  },
  function append(msg, color){
    var node = document.createElement('span');
    node.textContent = msg;
    node.style.color = color === undefined ? 'white' : color;
    this.element.appendChild(node);
  },
  function backspace(count){
    while (buffer.lastElementChild && count > 0) {
      var el = buffer.lastElementChild,
          len = el.textContent.length;
      if (len < count) {
        buffer.removeChild(el);
        count -= len;
      } else if (len === count) {
        buffer.removeChild(el);
        return true;
      } else {
        el.firstChild.data = el.firstChild.data.slice(0, el.firstChild.data.length - count);
        return true;
      }
    }
  }
]);


var attributes = ['___', 'E__', '_C_', 'EC_', '__W', 'E_W', '_CW', 'ECW', '__A', 'E_A', '_CA', 'ECA'];

function Property(mirror, key){
  Component.call(this, 'li');
  this.mirror = mirror;
  this.attrs = attributes[mirror.propAttributes(key)];
  this.key = _('div');
  this.addClass('property');
  this.key.textContent = key;
  this.key.classList.add(this.ns + 'key');
  this.key.classList.add(this.attrs);

  this.append(this.key);
  this.property = mirror.get(key);
  this.append(renderer.render(this.property));
}

inherit(Property, Component, [
  function refresh(){
    var attrs = attributes[this.mirror.propAttributes(this.key.textContent)];
    if (attrs !== this.attrs) {
      this.key.classList.remove(this.attrs);
      this.key.classList.add(attrs);
    }
  }
]);



function Proto(mirror){
  Component.call(this, 'li');
  this.mirror = mirror;
  this.key = _('div');
  this.addClass('property');
  this.key.textContent = '[[Proto]]';
  this.key.classList.add(this.ns + 'key');
  this.key.classList.add('Proto');
  this.append(this.key);
  this.property = mirror.getPrototype();
  this.append(renderer.render(this.property));
}

inherit(Proto, Property, [
  function refresh(){
    var proto = this.mirror.getPrototype();
    if (this.property !== proto) {
      this.property = proto;
      this.element.removeChild(this.element.lastElementChild);
      this.append(renderer.render(this.property));
    }
  }
]);



function Leaf(mirror){
  Component.call(this, 'div');
  this.mirror = mirror;
  this.addClass('leaf');
  this.label = _('div');
  this.label.className = this.ns + 'label '+mirror.kind;
  this.append(this.label);
  this.refresh();
}

Leaf.create = function create(mirror){
  return new Leaf(mirror);
}

inherit(Leaf, Component, [
  function refresh(){
    this.label.textContent = this.mirror.label();
    return this;
  }
]);



function StringLeaf(mirror){
  Leaf.call(this, mirror);
}

StringLeaf.create = function create(mirror){
  return new StringLeaf(mirror);
}

inherit(StringLeaf, Leaf, [
  function refresh(){
    this.label.textContent = utility.quotes(this.mirror.subject);
    return this;
  },
]);


function NumberLeaf(mirror){
  Leaf.call(this, mirror);
}

NumberLeaf.create = function create(mirror){
  return new NumberLeaf(mirror);
}

inherit(NumberLeaf, Leaf, [
  function refresh(){
    var label = this.mirror.label();
    this.label.textContent = label === 'number' ? this.mirror.subject : label;
    return this;
  },
]);




function Tree(){
  Component.call(this, 'ul');
  this.addClass('tree');
  this.expanded = false;
}

var placeholder = _('div');

function replace(parent, element, replacement){
  parent.insertBefore(placeholder, element);
  parent.removeChild(element);
}

inherit(Tree, Component, [
  function expand(){
    if (!this.expanded && this.emit('expand')) {
      this.addClass('expanded');
      this.expanded = true;
      return true;
    }
    return false;
  },
  function contract(){
    if (this.expanded && this.emit('contract')) {
      this.removeClass('expanded');
      this.expanded = false;
      return true;
    }
    return false;
  },
  function toggle(){
    if (this.expanded) {
      return this.contract();
    } else {
      return this.expand();
    }
  },
  function forEach(callback, context){
    context = context || this;
    var children = this.children || [];
    for (var i=0; i < children.length; i++) {
      callback.call(context, children[i], i, this);
    }
  }
]);






function Branch(mirror){
  var self = this,
      initialized;
  Component.call(this, 'div');
  this.mirror = mirror;
  this.label = _('div');
  this.label.className = this.ns + 'label '+mirror.kind;
  this.append(this.label);
  this.addClass('branch');
  this.tree = new Tree;
  this.append(this.tree);
  this.tree.on('expand', function(e){
    if (!initialized) {
      initialized = true;
      mirror.list(true, true).forEach(function(key){
        this.append(new Property(mirror, key));
      }, this);
      this.append(new Proto(mirror));
    } else {
      this.forEach(function(item){
        item.refresh();
      }, this);
    }
  });
  this.refresh();

  this.label.addEventListener('click', function(e){
    self.tree.toggle();
  });
}

Branch.create = function create(mirror){
  return new Branch(mirror);
}

inherit(Branch, Component, [
  function refresh(){
    this.label.textContent = this.mirror.label();
  }
]);


function FunctionBranch(mirror){
  Branch.call(this, mirror);
}

FunctionBranch.create = function create(mirror){
  return new FunctionBranch(mirror);
}

inherit(FunctionBranch, Branch, [
  function refresh(){
    var name = this.mirror.get('name').subject;
    this.label.textContent = name;
  }
])


var renderer = new debug.Renderer({
  Unknown: Branch.create,
  BooleanValue: Leaf.create,
  StringValue: StringLeaf.create,
  NumberValue: NumberLeaf.create,
  UndefinedValue: Leaf.create,
  NullValue: Leaf.create,
  Array: Branch.create,
  Boolean: Branch.create,
  Date: Branch.create,
  Function: FunctionBranch.create,
  Map: Branch.create,
  Object: Branch.create,
  Number: Branch.create,
  RegExp: Branch.create,
  Set: Branch.create,
  String: Branch.create,
  WeakMap: Branch.create
});



var input = new InputBox,
    stdout = new Console,
    root = _('div');

root.className = 'root';

input.on('entry', function(evt){
  if (root.firstChild) {
    root.removeChild(root.firstChild);
  }
  var result = renderer.render(context.eval(evt.value));
  root.appendChild(result.element);
  if (result.tree) {
    result.tree.expand();
  }
  console.log(result);
});


var main = new Panel(null, {
  anchor: 'full',
  name: 'container',
  left: {
    name: 'output',
    mainSize: 250,
    content: stdout
  },
  right: {
    name: 'view',
    mainSize: 'auto',
    content: root
  },
  bottom: {
    anchor: 'bottom',
    name: 'input',
    mainSize: 200,
    content: input
  }
});

console.log(main);

var context = new Continuum;
context.realm.on('write', stdout.append.bind(stdout));
context.realm.on('clear', stdout.clear.bind(stdout));
context.realm.on('backspace', stdout.backspace.bind(stdout));






})(this, continuum.Continuum, continuum.constants, continuum.utility, continuum.debug);
delete continuum

