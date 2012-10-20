var utility   = require('./utility'),
    util      = require('util');

var Visitor = utility.Visitor,
    Collector = utility.Collector,
    Stack = utility.Stack,
    define = utility.define,
    assign = utility.assign,
    create = utility.create,
    copy = utility.copy,
    parse = utility.parse,
    decompile = utility.decompile,
    inherit = utility.inherit,
    ownKeys = utility.keys,
    isObject = utility.isObject,
    quotes = utility.quotes;

var constants = require('./constants'),
    BINARYOPS = constants.BINARYOPS,
    UNARYOPS = constants.UNARYOPS,
    ENTRY = constants.ENTRY,
    AST = constants.AST,
    FUNCTYPE = constants.FUNCTYPE;


function parenter(node, parent){
  new Visitor(node, function(node){
    if (isObject(node) && parent)
      define(node, 'parent', parent);
    return Visitor.RECURSE;
  }).next();
}


var BoundNames = new Collector({
  ObjectPattern      : Visitor.RECURSE,
  ArrayPattern       : Visitor.RECURSE,
  VariableDeclaration: Visitor.RECURSE,
  VariableDeclarator : Visitor.RECURSE,
  BlockStatement     : Visitor.RECURSE,
  Property           : ['key', 'name'],
  Identifier         : ['name'],
  FunctionDeclaration: ['id', 'name'],
  ClassDeclaration   : ['id', 'name']
});


var collectExpectedArguments = new Collector({
  Identifier: ['name'],
  ObjectPattern: ['properties'],
  ArrayPattern: ['items'],
})

function ExpectedArgumentCount(args){
  return collectExpectedArguments(args).length;
}

var LexicalDeclarations = (function(lexical){
  return new Collector({
    ClassDeclaration: lexical(true),
    FunctionDeclaration: lexical(false),
    SwitchCase: Visitor.RECURSE,
    VariableDeclaration: lexical(function(node){
      return node.kind === 'const';
    }),
  });
})(function(isConst){
  if (typeof isConst !== 'function') {
    isConst = (function(v){
      return function(){ return v };
    })(isConst);
  }
  return function(node){
    node.IsConstantDeclaration = isConst(node);
    node.BoundNames = BoundNames(node);
    return node;
  };
});


function isSuperReference(node) {
  return !!node && node.type === 'Identifier' && node.name === 'super';
}

function ReferencesSuper(node){
  var found = false;
  Visitor.visit(node, function(node){
    if (!node) return Visitor.CONTINUE;
    switch (node.type) {
      case 'MemberExpression':
        if (isSuperReference(node.object)) {
          found = true;
          return Visitor.BREAK;
        }
      case 'CallExpression':
        if (isSuperReference(node.callee)) {
          found = true;
          return Visitor.BREAK;
        }
        break;
      case 'FunctionExpression':
      case 'FunctionDeclaration':
      case 'ArrowFunctionExpression':
        return Visitor.CONTINUE;
    }
    return Visitor.RECURSE;
  });
  return found;
}

function isUseStrictDirective(node){
  return node.type === 'ExpressionSatatement'
      && node.expression.type === 'Literal'
      && node.expression.value === 'use strict';
}

function isFunction(node){
  return node.type === 'FunctionDeclaration'
      || node.type === 'FunctionExpression'
      || node.type === 'ArrowFunctionExpression';
}

function isStrict(node){
  if (isFunction(node)) {
    node = node.body.body;
  } else if (node.type === 'Program') {
    node = node.body;
  }
  if (node instanceof Array) {
    for (var i=0, element;  element = node[i]; i++) {
      if (element) {
        if (isUseStrictDirective(element)) {
          return true;
        } else if (element.type !== 'EmptyStatement' && element.type !== 'FunctionDeclaration') {
          return false;
        }
      }
    }
  }
  return false;
}


function Operations(){
  this.length = 0;
}

inherit(Operations, Array, [
  function toJSON(){
    return this.map(function(op){
      return op.toJSON();
    });
  }
]);

function Params(params, names, rest){
  this.length = 0;
  if (params) {
    [].push.apply(this, params);
  }
  this.Rest = rest;
  this.BoundNames = names;
  this.ExpectedArgumentCount = ExpectedArgumentCount(this);
}

function recurse(o){
  var out = o instanceof Array ? [] : {};
  if (o.type === 'Identifier') {
    return o.name;
  }
  ownKeys(o).forEach(function(key){
    if (key === 'type' && o.type in types) {
      out.type = types[o.type];
    } else if (o[key] && typeof o[key] === 'object') {
      out[key] = recurse(o[key]);
    } else {
      out[key] = o[key];
    }
  });
  return out;
}

define(Params.prototype, [
  function toJSON(){
    return [recurse([].slice.call(this)),  this.BoundNames];
  }
]);

function Code(node, source, type, isGlobal, strict){
  this.topLevel = node.type === 'Program';
  var body = this.topLevel ? node : node.body;
  define(this, {
    body: body,
    source: source,
    LexicalDeclarations: LexicalDeclarations(node)
  });

  this.isGlobal = isGlobal;
  this.entrances = [];
  this.Type = type || FUNCTYPE.hash.NORMAL;
  this.VarDeclaredNames = [];
  this.NeedsSuperBinding = ReferencesSuper(this.body);
  this.Strict = strict || isStrict(this.body);
  this.params = new Params(node.params, BoundNames(node), node.rest);
  this.ops = new Operations;
  this.children = [];
}
var identifiersPrinted = false;

define(Code.prototype, [
  function inherit(code){
    if (code) {
      this.identifiers = code.identifiers;
      this.hash = code.hash;
      this.natives = code.natives;
    }
  },
  function intern(name){
    return name;
    if (name in this.hash) {
      return this.hash[name];
    } else {
      var index = this.hash[name] = this.identifiers.length;
      this.identifiers[index] = name;
      return index;
    }
  },
  function lookup(id){
    return id;
    if (typeof id === 'number') {
      return this.identifiers[id];
    } else {
      return id;
    }
  },
  function toJSON(){
    var out = {}

    out.type = this.Type;
    out.params = this.params.toJSON();
    out.ops = this.ops.toJSON()
    out.params[0] = out.params[0].map(this.intern.bind(this));
    out.params[1] = out.params[1].map(function(param){
      if (typeof param === 'string') {
        return this.intern(param);
      } else {
        return param;
      }
    }, this);
    if (this.VarDeclaredNames.length) {
      out.vars = this.VarDeclaredNames.map(this.intern.bind(this));
    }
    if (this.LexicalDeclarations.length) {
      out.decls = this.LexicalDeclarations;
    }
    if (this.topLevel) {
      if (this.natives) {
        out.natives = true;
      }
    }
    if (this.eval) {
      out.eval = true;
    }
    if (this.isGlobal) {
      out.isGlobal = true;
    }
    if (this.entrances.length) {
      out.entrances = this.entrances.map(function(entrance){
        return entrance.toJSON();
      });
    }
    if (this.NeedsSuperBinding) {
      out.needsSuper = true;
    }

    if (this.topLevel) {
      out.identifiers = this.identifiers;
    }
    return out;
  }
]);


function OpCode(id, params, name){
  this.id = id;
  this.params = params;
  this.name = name;
}

define(OpCode.prototype, [
  function inspect(){
    return this.name;
  },
  function toString(){
    return this.name
  },
  function valueOf(){
    return this.id;
  },
  function toJSON(){
    return this.id;
  }
]);



var ARRAY          = new OpCode( 0, 0, 'ARRAY'),
    ARRAY_DONE     = new OpCode( 1, 0, 'ARRAY_DONE'),
    BINARY         = new OpCode( 2, 1, 'BINARY'),
    BLOCK          = new OpCode( 3, 1, 'BLOCK'),
    BLOCK_EXIT     = new OpCode( 4, 0, 'BLOCK_EXIT'),
    CALL           = new OpCode( 5, 1, 'CALL'),
    CASE           = new OpCode( 6, 1, 'CASE'),
    CLASS_DECL     = new OpCode( 7, 4, 'CLASS_DECL'),
    CLASS_EXPR     = new OpCode( 8, 4, 'CLASS_EXPR'),
    CONST          = new OpCode( 9, 1, 'CONST'),
    CONSTRUCT      = new OpCode(10, 1, 'CONSTRUCT'),
    DEBUGGER       = new OpCode(11, 0, 'DEBUGGER'),
    DEFAULT        = new OpCode(12, 1, 'DEFAULT'),
    DUP            = new OpCode(13, 0, 'DUP'),
    ELEMENT        = new OpCode(14, 0, 'ELEMENT'),
    FUNCTION       = new OpCode(15, 2, 'FUNCTION'),
    GET            = new OpCode(16, 0, 'GET'),
    IFEQ           = new OpCode(17, 2, 'IFEQ'),
    IFNE           = new OpCode(18, 2, 'IFNE'),
    INDEX          = new OpCode(19, 1, 'INDEX'),
    JSR            = new OpCode(20, 2, 'JSR'),
    JUMP           = new OpCode(21, 1, 'JUMP'),
    LET            = new OpCode(22, 1, 'LET'),
    LITERAL        = new OpCode(23, 1, 'LITERAL'),
    MEMBER         = new OpCode(24, 1, 'MEMBER'),
    METHOD         = new OpCode(25, 3, 'METHOD'),
    OBJECT         = new OpCode(26, 0, 'OBJECT'),
    POP            = new OpCode(27, 0, 'POP'),
    SAVE           = new OpCode(28, 0, 'SAVE'),
    POPN           = new OpCode(29, 1, 'POPN'),
    PROPERTY       = new OpCode(30, 1, 'PROPERTY'),
    PUT            = new OpCode(31, 0, 'PUT'),
    REGEXP         = new OpCode(32, 1, 'REGEXP'),
    RESOLVE        = new OpCode(33, 1, 'RESOLVE'),
    RETURN         = new OpCode(34, 0, 'RETURN'),
    COMPLETE       = new OpCode(35, 0, 'COMPLETE'),
    RUN            = new OpCode(36, 0, 'RUN'),
    ROTATE         = new OpCode(37, 1, 'ROTATE'),
    SUPER_CALL     = new OpCode(38, 0, 'SUPER_CALL'),
    SUPER_ELEMENT  = new OpCode(39, 0, 'SUPER_ELEMENT'),
    SUPER_GUARD    = new OpCode(40, 0, 'SUPER_GUARD'),
    SUPER_MEMBER   = new OpCode(41, 1, 'SUPER_MEMBER'),
    THIS           = new OpCode(42, 0, 'THIS'),
    THROW          = new OpCode(43, 1, 'THROW'),
    UNARY          = new OpCode(44, 1, 'UNARY'),
    UNDEFINED      = new OpCode(45, 0, 'UNDEFINED'),
    UPDATE         = new OpCode(46, 1, 'UPDATE'),
    VAR            = new OpCode(47, 1, 'VAR'),
    WITH           = new OpCode(48, 0, 'WITH'),
    NATIVE_RESOLVE = new OpCode(49, 1, 'NATIVE_RESOLVE'),
    ENUM           = new OpCode(50, 0, 'ENUM'),
    NEXT           = new OpCode(51, 1, 'NEXT'),
    STRING         = new OpCode(52, 1, 'STRING');



function Operation(op, a, b, c, d){
  this.op = op;
  for (var i=0; i < op.params; i++) {
    this[i] = arguments[i + 1];
  }
}

define(Operation.prototype, [
  function inspect(){
    var out = [];
    for (var i=0; i < this.op.params; i++) {
      if (typeof this[i] !== 'object')
        out.push(util.inspect(this[i]));
    }

    return util.inspect(this.op)+'('+out.join(', ')+')';
  },
  function toJSON(){
    if (this.op.params) {
      var out = [this.op.toJSON()];
      for (var i=0; i < this.op.params; i++) {
        if (this[i] && this[i].toJSON) {
          out[i+1] = this[i].toJSON();
        } else if (typeof this[i] === 'boolean') {
          out[i+1] = +this[i];
        } else if (typeof this[i] !== 'object' || this[i] == null) {
          out[i+1] = this[i];
        }
      }
      return out;
    } else {
      return this.op.toJSON()
    }
  }
]);



function Handler(type, begin, end){
  this.type = type;
  this.begin = begin;
  this.end = end;
}

define(Handler.prototype, [
  function toJSON(){
    return [this.type, this.begin, this.end];
  }
]);



function Entry(labels, level){
  this.labels = labels;
  this.level = level;
  this.breaks = [];
  this.continues = [];
}

define(Entry.prototype, {
  labels: null,
  breaks: null,
  continues: null,
  level: null
})

define(Entry.prototype, [
  function updateContinues(address){
    for (var i=0, item; item = this.breaks[i]; i++)
      item.position = breakAddress;
  },
  function updateBreaks(address){
    for (var i=0, item; item = this.continues[i]; i++)
      item.position = continueAddress;
  }
]);


function CompilerOptions(o){
  o = Object(o);
  for (var k in this)
    this[k] = k in o ? o[k] : this[k];
}

CompilerOptions.prototype = {
  eval: false,
  function: true,
  scoped: false,
  natives: false
};


function Compiler(options){
  this.options = new CompilerOptions(options);
}

define(Compiler.prototype, {
  source: null,
  node: null,
  code: null,
  pending: null,
  levels: null,
  jumps: null,
  labels: null,
});

define(Compiler.prototype, [
  function compile(source){
    this.pending = new Stack;
    this.levels = new Stack;
    this.jumps = new Stack;
    this.labels = null;

    var node = parse(source);
    if (this.options.function)
      node = node.body[0].expression;


    var type = this.options.eval ? 'eval' : this.options.function ? 'function' : 'global';
    var code = new Code(node, source, type, !this.options.scoped);
    code.identifiers = [];
    code.hash = create(null);
    code.topLevel = true;
    if (this.options.natives) {
      code.natives = true;
    }

    this.queue(code);
    parenter(node);


    while (this.pending.length) {
      var lastCode = this.code;
      this.code = this.pending.pop();
      if (lastCode) {
        this.code.inherit(lastCode);
      }
      this.visit(this.code.body);
      if (this.code.eval || this.code.isGlobal){
        this.record(COMPLETE);
      } else {
        this.record(UNDEFINED);
        this.record(RETURN);
      }
    }

    return code;
  },
  function queue(code){
    if (this.code) {
      this.code.children.push(code);
    }
    this.pending.push(code);
  },
  function visit(node){
    if (node) {
      this[node.type](node);
    }
    return this;
  },
  function record(code, a, b, c, d){
    var op = new Operation(code, a, b, c, d);
    this.code.ops.push(op);
    return op;
  },
  function current(){
    return this.code.ops.length;
  },
  function last(){
    return this.code.ops[this.code.ops.length - 1];
  },
  function adjust(op){
    return op[0] = this.code.ops.length;
  },

  function withBlock(func){
    if (this.labels){
      var entry = new Entry(this.labels, this.levels.length);
      this.jumps.push(entry);
      this.labels = create(null);
      func.call(this, function(b, c){
        entry.updateBreaks(b);
      });
      this.jumps.pop();
    } else {
      func.call(this, function(){});
    }
  },
  function withEntry(func){
    var entry = new Entry(this.labels, this.levels.length);
    this.jumps.push(entry);
    this.labels = create(null);
    func.call(this, function (b, c){
      entry.updateBreaks(b);
      if (c !== undefined) {
        entry.updateContinues(c);
      }
    });
    this.jumps.pop();
  },
  function recordEntrypoint(type, func){
    var begin = this.current();
    func.call(this);
    this.code.entrances.push(new Handler(type, begin, this.current()));
  },
  function move(node){
    if (node.label) {
      var entry = this.jumps.first(function(entry){
        return node.label.name in entry.labels;
      });
    } else {
      var entry = this.jumps.first(function(entry){
        return entry && entry.continues;
      });
    }

    var levels = {
      FINALLY: function(level){
        level.entries.push(this.record(JSR, 0, false));
      },
      WITH: function(){
        this.record(BLOCK_EXIT);
      },
      SUBROUTINE: function(){
        this.record(POPN, 3);
      },
      FORIN: function(){
        entry.level + 1 !== len && this.record(POP);
      }
    };

    var min = entry ? entry.level : 0;
    for (var len = this.levels.length; len > min; --len){
      var level = this.levels[len - 1];
      levels[level.type].call(this, level);
    }

    return entry;
  },
  function AssignmentExpression(node){
    if (node.operator === '='){
      if (node.left.type === 'ObjectPattern' || node.left.type === 'ArrayPattern'){
        this.destructure(node);
      } else {
        this.visit(node.left)
        this.visit(node.right);
        this.record(GET);
        this.record(PUT);
      }
    } else {
      this.visit(node.left);
      this.record(DUP);
      this.record(GET);
      this.visit(node.right);
      this.record(GET);
      this.record(BINARY, BINARYOPS.getIndex(node.operator.slice(0, -1)));
      this.record(PUT);
    }
  },
  function ArrayExpression(node){
    this.record(ARRAY);
    for (var i=0, item; i < node.elements.length; i++) {
      var empty = false,
          spread = false,
          item = node.elements[i];

      if (!item){
        empty = true;
      } else if (item.type === 'SpreadElement'){
        spread = true;
        this.visit(item.argument);
      } else {
        this.visit(item);
      }

      this.record(INDEX, empty, spread);
    }

    this.record(ARRAY_DONE);
  },
  function ArrowFunctionExpression(node){
    var code = new Code(node, this.code.source, FUNCTYPE.hash.ARROW, false, this.code.strict);
    this.queue(code);
    this.record(FUNCTION, null, code);
  },
  function BinaryExpression(node){
    this.visit(node.left);
    this.record(GET);
    this.visit(node.right);
    this.record(GET);
    this.record(BINARY, BINARYOPS.getIndex(node.operator));
  },
  function BreakStatement(node){
    var entry = this.move(node);
    if (entry) {
      entry.breaks.push(this.record(JUMP, 0));
    }
  },
  function BlockStatement(node){
    this.withBlock(function(patch){
      this.recordEntrypoint(ENTRY.hash.ENV, function(){
        this.record(BLOCK, { LexicalDeclarations: LexicalDeclarations(node.body) });

        for (var i=0, item; item = node.body[i]; i++)
          this.visit(item);

        this.record(BLOCK_EXIT);
      });
      patch(this.current());
    });
  },
  function CallExpression(node){
    if (isSuperReference(node.callee)) {
      if (this.code.Type === 'global' || this.code.Type === 'eval' && this.code.isGlobal)
        throw new Error('Illegal super reference');
      this.record(SUPER_CALL);
    } else {
      this.visit(node.callee);
    }
    this.record(DUP);
    this.record(GET);

    for (var i=0, item; item = node.arguments[i]; i++) {
      this.visit(item);
      this.record(GET);
    }

    this.record(CALL, node.arguments.length);
  },
  function CatchClause(node){
    this.recordEntrypoint(ENTRY.hash.ENV, function(){
      var decls = LexicalDeclarations(node.body);
      decls.push({
        type: 'VariableDeclaration',
        kind: 'var',
        IsConstantDeclaration: false,
        BoundNames: [node.param.name],
        declarations: [{
          type: 'VariableDeclarator',
          id: node.param,
          init: undefined
        }]
      });
      this.record(BLOCK, { LexicalDeclarations: decls });
      this.visit(node.param);
      this.record(GET);
      this.record(PUT);
      for (var i=0, item; item = node.body.body[i]; i++)
        this.visit(item);

      this.record(BLOCK_EXIT);
    });
  },
  function ClassDeclaration(node){
    var name = node.id ? node.id.name : null,
        methods = [],
        ctor;

    for (var i=0, method; method = node.body.body[i]; i++) {
      var code = new Code(method.value, this.source, FUNCTYPE.hash.METHOD, false, this.code.strict);
      code.name = method.key.name;
      this.pending.push(code);

      if (method.kind === '') {
        method.kind = 'method';
      }

      if (method.key.name === 'constructor') {
        ctor = code;
      } else {
        methods.push({
          kind: kind,
          code: code,
          name: method.key.name
        });
      }
    }

    var superClass = null;
    if (node.superClass) {
      this.visit(node.superClass);
      this.record(GET);
      superClass = node.superClass.name;
    }

    var type = node.type === 'ClassExpression' ? CLASS_EXPR : CLASS_DECL;
    this.record(type, node.id, superClass, ctor, methods);
  },
  function ClassExpression(node){
    this.ClassDeclaration(node);
  },
  function ConditionalExpression(node){
    this.visit(node.test);
    this.record(GET);
    var op1 = this.record(IFEQ, 0, false);
    this.visit(node.consequent)
    this.record(GET);
    var op2 = this.record(JUMP, 0);
    this.adjust(op1);
    this.visit(node.alternate);
    this.record(GET);
    this.adjust(op2)
  },
  function ContinueStatement(node){
    var entry = this.move(node);
    if (entry)
      entry.continues.push(this.record(JUMP, 0));
  },
  function DoWhileStatement(node){
    this.withEntry(function(patch){
      var start = this.current();
      this.visit(node.body);
      var cond = this.current();
      this.visit(node.test);
      this.record(GET);
      this.record(IFEQ, start, true);
      patch(this.current(), cond);
    });
  },
  function DebuggerStatement(node){
    this.record(DEBUGGER);
  },
  function EmptyStatement(node){},
  function ExportSpecifier(node){},
  function ExportSpecifierSet(node){},
  function ExportDeclaration(node){},
  function ExpressionStatement(node){
    this.visit(node.expression);
    this.record(GET);
    if (this.code.eval || this.code.isGlobal) {
      this.record(SAVE)
    } else {
      this.record(POP);
    }
  },

  function ForStatement(node){
    this.withEntry(function(patch){
      if (node.init){
        this.visit(node.init);
        if (node.init.type !== 'VariableDeclaration') {
          this.record(GET);
          this.record(POP);
        }
      }

      var cond = this.current();
      if (node.test) {
        this.visit(node.test);
        this.record(GET);
        var op = this.record(IFEQ, 0, false);
      }

      var update = this.current();
      this.visit(node.body);
      if (node.update) {
        this.visit(node.update);
        this.record(GET);
        this.record(POP);
      }

      this.record(JUMP, update);
      this.adjust(op);
      patch(this.current(), update);
    });
  },
  function ForInStatement(node){
    this.withEntry(function(patch){
      this.visit(node.left);
      this.record(RESOLVE, this.last()[0].name);
      this.visit(node.right);
      this.record(GET);
      var update = this.current();
      this.record(ENUM);
      var op = this.record(NEXT);
      this.visit(node.body);
      this.adjust(op);
      this.record(JUMP, update);
      this.record(POPN, 2);
      patch(this.current(), update);
    });
  },
  function ForOfStatement(node){
    this.withEntry(function(patch){
      this.visit(node.right);
      this.record(GET);
      this.record(MEMBER, this.code.intern('iterator'));
      this.record(GET);
      this.record(CALL, 0);
      this.record(ROTATE, 4);
      this.record(POPN, 3);
      var update = this.current();
      this.record(MEMBER, this.code.intern('next'));
      this.record(GET);
      this.record(CALL, 0);
      this.visit(node.left);
      this.visit(node.body);
      this.adjust(op);
      this.record(JUMP, update);
      this.record(POPN, 2);
      patch(this.current(), update);
    });
  },
  function FunctionDeclaration(node){
    node.Code = new Code(node, this.code.source, FUNCTYPE.hash.NORMAL, false, this.code.strict);
    this.queue(node.Code);
  },
  function FunctionExpression(node){
    var code = new Code(node, this.code.source, FUNCTYPE.hash.NORMAL, false, this.code.strict);
    this.queue(code);
    var name = node.id ? node.id.name : '';
    this.record(FUNCTION, this.code.intern(name), code);
  },
  function Identifier(node){
    this.record(RESOLVE, this.code.intern(node.name));
  },
  function IfStatement(node){
    this.visit(node.test);
    this.record(GET);
    var op = this.record(IFEQ, 0, false);
    this.visit(node.consequent);
    this.adjust(op);

    if (node.alternate) {
      op = this.record(JUMP, 0);
      this.visit(node.alternate);
      this.adjust(op);
    }
  },
  function ImportDeclaration(node){},
  function ImportSpecifier(spec){},
  function Literal(node){
    if (node.value instanceof RegExp) {
      this.record(REGEXP, node.value);
    } else if (typeof node.value === 'string') {
      this.record(STRING, this.code.intern(node.value));
    } else {
      this.record(LITERAL, node.value);
    }
  },
  function LabeledStatement(node){
    if (!this.labels){
      this.labels = create(null);
    } else if (label in this.labels) {
      throw new SyntaxError('duplicate label');
    }
    this.labels[node.label.name] = true;
    this.visit(node.body);
    this.labels = null;
  },
  function LogicalExpression(node){
    this.visit(node.left);
    this.record(GET);
    var op = this.record(IFNE, 0, node.operator === '||');
    this.visit(node.right);
    this.record(GET);
    this.adjust(op);
  },
  function MemberExpression(node){
    var isSuper = isSuperReference(node.object);
    if (isSuper){
      if (this.code.Type === 'global' || this.code.Type === 'eval' && this.code.isGlobal)
        throw new Error('Illegal super reference');
      this.record(SUPER_GUARD);
    } else {
      this.visit(node.object);
      this.record(GET);
    }

    if (node.computed){
      this.visit(node.property);
      this.record(GET);
      this.record(isSuper ? SUPER_ELEMENT : ELEMENT);
    } else {
      this.record(isSuper ? SUPER_MEMBER : MEMBER, this.code.intern(node.property.name));
    }
  },
  function ModuleDeclaration(node){ },
  function NativeIdentifier(node){
    this.record(NATIVE_RESOLVE, this.code.intern(node.name));
  },
  function NewExpression(node){
    this.visit(node.callee);
    this.record(GET);
    for (var i=0, item; item = node.arguments[i]; i++) {
      this.visit(item);
      this.record(GET);
    }
    this.record(CONSTRUCT, i);
  },
  function ObjectExpression(node){
    this.record(OBJECT);
    for (var i=0, item; item = node.properties[i]; i++)
      this.visit(item);
  },
  function Program(node){
    this.record(RUN);
    for (var i=0, item; item = node.body[i]; i++)
      this.visit(item);
  },
  function Property(node){
    if (node.kind === 'init'){
      this.visit(node.value);
      this.record(GET);
      this.record(PROPERTY, this.code.intern(node.key.name));
    } else {
      var code = new Code(node.value, this.source, FUNCTYPE.hash.METHOD, false, this.code.strict);
      this.queue(code);

      if (code.NeedsSuperBinding) {

      }

      this.record(METHOD, node.kind, code, this.code.intern(node.key.name));
    }
  },
  function ReturnStatement(node){
    if (node.argument){
      this.visit(node.argument);
      this.record(GET);
    } else {
      this.record(UNDEFINED);
    }

    var levels = {
      FINALLY: function(level){
        level.entries.push(this.record(JSR, 0, true));
      },
      WITH: function(){
        this.record(BLOCK_EXIT);
      },
      SUBROUTINE: function(){
        this.record(ROTATE, 4);
        this.record(POPN, 4);
      },
      FORIN: function(){
        this.record(ROTATE, 4);
        this.record(POP);
      }
    };

    for (var len = this.levels.length; len > 0; --len){
      var level = this.levels[len - 1];
      levels[level.type].call(this, level);
    }

    this.record(RETURN);
  },
  function SequenceExpression(node){
    for (var i=0, item; item = node.expressions[i]; i++) {
      this.visit(item)
      this.record(GET);
      this.record(POP);
    }
    this.visit(item);
    this.record(GET);
  },
  function SwitchStatement(node){
    this.withEntry(function(patch){
      this.visit(node.discriminant);
      this.record(GET);

      this.recordEntrypoint(ENTRY.hash.ENV, function(){
        this.record(BLOCK, { LexicalDeclarations: LexicalDeclarations(node.cases) });

        if (node.cases){
          var cases = [];
          for (var i=0, item; item = node.cases[i]; i++) {
            if (item.test){
              this.visit(item.test);
              this.record(GET);
              cases.push(this.record(CASE, 0));
            } else {
              var defaultFound = i;
              cases.push(0);
            }

          }

          if (defaultFound != null){
            this.record(DEFAULT, cases[defaultFound]);
          } else {
            this.record(POP);
            var last = this.record(JUMP, 0);
          }

          for (var i=0, item; item = node.cases[i]; i++) {
            this.adjust(cases[i])
            for (var j=0, consequent; consequent = item.consequent[j]; j++)
              this.visit(consequent);
          }

          if (last) {
            this.adjust(last);
          }
        } else {
          this.record(POP);
        }

        this.record(BLOCK_EXIT);
      });
      patch(this.current());
    });
  },
  function ThisExpression(node){
    this.record(THIS);
  },
  function ThrowStatement(node){
    this.visit(node.argument);
    this.record(GET);
    this.record(THROW);
  },
  function TryStatement(node){
    this.recordEntrypoint(TRYCATCH, function(){
      this.visit(node.block);
    });
    var count = node.handlers.length,
        tryer = this.record(JUMP, 0),
        handlers = [tryer];

    for (var i=0; i < count; i++) {
      this.visit(node.handlers[i]);
      if (i < count - 1) {
        handlers.push(this.record(JUMP, 0));
      }
    }

    while (i--) {
      this.adjust(handlers[i]);
    }

    if (node.finalizer) {
      this.visit(node.finalizer);
    }
  },
  function UnaryExpression(node){
    this.visit(node.argument);
    this.record(UNARY, UNARYOPS.getIndex(node.operator));
  },
  function UpdateExpression(node){
    this.visit(node.argument);
    this.record(UPDATE, !!node.prefix | ((node.operator === '++') << 1));
  },
  function VariableDeclaration(node){
    var op = {
      var: VAR,
      const: CONST,
      let: LET
    }[node.kind];

    for (var i=0, item; item = node.declarations[i]; i++) {
      if (item.init) {
        this.visit(item.init);
        this.record(GET);
      } else if (item.kind === 'let') {
        this.record(UNDEFINED);
      }

      this.record(op, item.id);

      if (node.kind === 'var')
        this.code.VarDeclaredNames.push(item.id.name);
    }
  },
  function VariableDeclarator(node){},
  function WhileStatement(node){
    this.withEntry(function(patch){
      var start = this.current();
      this.visit(node.test);
      this.record(GET);
      var op = this.record(IFEQ, 0, false)
      this.visit(node.body);
      this.record(JUMP, start);
      patch(this.adjust(op), start);
    });
  },
  function WithStatement(node){
    this.visit(node.object)
    this.recordEntrypoint(ENTRY.hash.ENV, function(){
      this.record(WITH);
      this.visit(node.body);
      this.record(BLOCK_EXIT);
    });
  }
]);



function compile(code, options){
  var compiler = new Compiler(assign({ function: false }, options));
  return compiler.compile(code);
}

function inspect(o){
  console.log(require('util').inspect(o, null, 10));
}

// inspect(compile('try { var x = [1,2,3] } catch (e) { x = e } finally { done = x }'))




//inspect(compile('function xy(){ this.hello = true }; global = this'))
module.exports = compile;

//inspect(test.compile('var k = reset(()=> shift(k => k) * 2);'));
//inspect(test.compile('function k(shift){ return 2 * shift }'));


//inspect(test.compile('class Test extends T { constructor(){ super() } }'));
// 'reset(() => {\n'+
// '  console.log(1);\n'+
// '  shift(cont => {\n'+
// '    cont();\n'+
// '    cont();\n'+
// '    console.log(2);\n'+
// '  });\n'+
// '  console.log(3);\n'+
// '});\n'));
//prints: 1 3 3 2

