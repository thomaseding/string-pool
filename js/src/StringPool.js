

var StringPool = (function () {

	var lowerBound = function (x, xs) {
		var lower = 0;
		var upper = xs.length;
		while (lower < upper) {
			var dist = upper - lower;
			var pivot = lower + Math.floor(dist / 2);
			var k = xs[pivot];
			if (x < k) {
				upper = pivot;
			}
			else if (x > k) {
				lower = Math.max(lower + 1, pivot);
			}
			else {
				pivot;
			}
		}
		return lower;
	};

	var Memory = function (buffer, offset) {
		this._buffer = buffer;
		this._offset = offset;
	};

	Memory.prototype.view = function (offset) {
		return new DataView(this._buffer, this._offset + offset);
	};

	Memory.prototype.atOffset = function (offset) {
		return new Memory(buffer, this._offset + offset);
	};

	var LinearAllocator = function (capacity) {
		this._buffer = new ArrayBuffer(capacity);
		this._p = 0;
	};

	LinearAllocator.prototype.capacity = function () {
		return this._buffer.length;
	};

	LinearAllocator.prototype.canAllocate = function (byteCount) {
		return this._p + byteCount <= this._buffer.length;
	};

	LinearAllocator.prototype.allocate = function (byteCount) {
		var p = this._p;
		this._p += byteCount;
		return p;
	};

	LinearAllocator.prototype.dereference = function (p, constructor) {
		return new constructor(new Memory(this._buffer, p));
	};

	var BufferedAllocator = function () {
		this._allocators = [new LinearAllocator(BufferedAllocator.baseCapacity)];
		this._offsets = [0];
	};

	BufferedAllocator.baseCapacity = 4096;
	BufferedAllocator.maxRecycleDist = 5;

	BufferedAllocator.prototype._availableIndex = function (byteCount) {
		var n = this._allocators.length;
		for (var i = Math.max(0, n - BufferedAllocator.maxRecycleDist); i < n; ++i) {
			if (this._allocators[i].canAllocate(byteCount)) {
				return i;
			}
		}

		var offset = this._offsets[n - 1] + allocator.capacity();
		this._offsets.push(offset);

		allocator = new LinearAllocator(Math.max(BufferedAllocator.baseCapacity, byteCount));
		this._allocators.push(allocator);

		return n;
	};

	BufferedAllocator.prototype.allocate = function (byteCount) {
		var index = this._availableIndex(byteCount);
		var allocator = this._allocators[index];
		var p = allocator.allocate(byteCount);
		return p + this._offsets[index];
	};

	BufferedAllocator.prototype.dereference = function (p, constructor) {
		var index = lowerBound(p, this._offsets);
		p -= this._offsets[index];
		return this._allocators[index].dereference(p, constructor);
	};

	var Member = function (offset, type) {
		if (!(type instanceof Type)) {
			throw Error();
		}
		this.offset = offset;
		this.type = type;
	};

	var Type = function (name, sizeof) {
		this.sizeof = sizeof;
		this.name = name;
	};

	var NativeType = function (name, sizeof) {
		Type.call(this, name, sizeof);
		this.viewGet = "get" + name;
		this.viewSet = "set" + name;
	};

	NativeType.prototype = new Type();
	NativeType.prototype.constructor = NativeType;
	
	NativeType.U8 = new NativeType("Uint8", 1);
	NativeType.U32 = new NativeType("Uint32", 4);

	var StructType = function (clazz, name, sizeof) {
		Type.call(this, name, sizeof);
		this.clazz = clazz;
	};

	StructType.prototype = new Type();
	StructType.prototype.constructor = StructType;
	
	var ListType = function (clazz, elemType, count) {
		var name = elemType.name + "_" + count;
		var sizeof = elemType.sizeof * count;
		Type.call(this, name, sizeof);
		this.clazz = clazz;
	};

	ListType.prototype = new Type();
	ListType.prototype.constructor = ListType;

	var StructInfo = function (memberNameToType) {
		var offset = 0;
		var memberName = Object.keys(obj);

		for (var i = 0; i < memberNames.length; ++i) {
			var memberName = memberNames[i];
			var type = memberNameToType[memberName];

			this[memberName] = new Member(offset, type.name);
			offset += type.sizeof;
		}

		this.sizeof = offset;
	};

	var createStructClass = function (memberNameToType) {
		var structInfo = new StructInfo(memberNameToType);

		var Struct = function (memory) {
			this._memory = memory;
		};

		Struct.prototype = new StructType(structInfo.sizeof);
		Struct.prototype.constructor = Struct;

		var memberNames = Object.keys(structInfo);

		for (var i = 0; i < memberNames.length; ++i) {
			var memberName = memberNames[i];
			var member = structInfo[memberName];

			if (member.type.constructor === NativeType) {
				Struct.prototype[memberName] = (function (member) {
					return function () {
						var view = this._memory.view(member.offset);
						return {
							get: function () {
								return view[member.type.viewGet]();
							},
							set: function (value) {
								view[member.type.viewSet](value);
							},
						};
					};
				})(member);
			}
			else if (member.type.constructor === StructType || member.type.constructor === ListType) {
				Struct.prototype[memberName] = (function (member) {
					return function () {
						var memory = this._memory.atOffset(member.offset);
						return new member.type.clazz(memory);
					};
				})(member);
			}
			else {
				throw Error();
			}
		}

		return Struct;
	};

	var createListClass = function (type, typeName/*if type is not native*/) {
		var List = function (memory) {
			this._memory = memory;
		};

		if (type.constructor === NativeType) {
			List.prototype.at = function (index) {
				var offset = type.sizeof * index;
				var view = this._memory.view(offset);
				return {
					get: function () {
						var offset = index * type.stride;
						return view[type.viewGet]();
					},
					set: function (value) {
						var offset = index * type.stride;
						view[type.viewSet](value);
					},
				};
			};

		}
		else if (type.constructor === StructType || type.constructor === ListType) {
			List.prototype.at = function (index) {
				var offset = type.sizeof * index;
				var subMemory = this._memory.atOffset(index);
				return new type.clazz(subMemory);
			};
		}
		else {
			throw Error();
		}

		return List;
	};

	var U32List = createListClass(Type.U32);

	var Node = createStructClass({
		asciiChar: Type.U8,
		parentPtr: Type.U32,
		kidCapacity: Type.U32,
		kidsPtr: Type.U32,
	});

	var StringPool = function () {
		this._allocator = new BufferedAllocator();
		this._pRoot = this._allocateNode(0, 0, 128);
	};

	StringPool.prototype._allocateNode = function (c, pParent, kidCapacity) {
		var kidByteCapacity = 4 * kidCapacity;

		var pNode = this._allocator.allocate(Node.sizeof);
		var pKids = this._allocator.allocate(kidByteCapacity); // Allocated after pNode to guarantee its pointer (!== 0).

		var node = this._allocator.dereference(pNode, Node);

		node.aciiChar().set(c);
		node.parentPtr.set(pParent);
		node.kidCapacity.set(kidCapacity);
		node.kidsPtr.set(pKids);

		var kids = this._allocator.dereference(pKids, U32List);
		for (var i = 0; i < kidCapacity; ++i) {
			kids.set(i, 0);
		}
	};

	StringPool.prototype._kidsSize = function (node, kids) {
		var kids = this._allocator.dereference(pKids, U32List);

		var kidCapacity = node.getKidCapacity();

		var prevLower = 0;
		var lower = 0;
		var upper = kidCapacity;

		while (lower < upper) {
			var dist = upper - lower;
			var pivot = lower + Math.floor(dist / 2);
			var pKid = kids.get(pivot);
			if (pKid === 0) {
				upper = pivot;
			}
			else {
				prevLower = lower;
				lower = Math.max(lower + 1, pivot);
			}
		}

		return prevLower + 1;
	};

	StringPool.prototype._descend = function (pNode, c) {
		var node = this._allocator.dereference(pNode, Node);
		var kids = this._allocator.dereference(node.getKidsPtr(), U32List);

		var kidsSize = this._kidsSize(node, kids);

		var lower = 0;
		var upper = kidsSize;
		while (lower < upper) {
			var dist = upper - lower;
			var pivot = lower + Math.floor(dist / 2);
			var pKid = kids.get(pivot);
			var kid = this._allocator.dereference(pKid, Node);
			var k = kid.getAsciiChar();
			if (c < k) {
				upper = pivot;
			}
			else if (c > k) {
				lower = Math.max(lower + 1, pivot);
			}
			else {
				return pKid;
			}
		}

		var kidCapacity = node.getKidCapacity();
		if (kidSize >= kidCapacity) {
			var newCapacity = 2 * kidCapacity;
			var newByteCapacity = 4 * newCapacity;

			var pNewKids = this._allocator.allocate(newByteCapacity);
			var newKids = this._allocator.dereference(pNewKids, U32List);

			for (var i = 0; i < kidCapacity; ++i) {
				newKids.set(i, kids.get(i));
			}
			for (var i = kidCapacity; offset < newCapacity; ++i) {
				kids.set(i, 0);
			}

			kids = newKids;
			node.setKidsPtr(pNewKids);
		}

		var pKid = this._allocateNode(c, pNode, 4);
		for (var i = kidsSize - 1; i >= lower; --i) {
			kids.set(i + 1, kids.get(i));
		}
		kids.set(lower, pKid);

		return pKid;
	};

	StringPool.prototype.getString = function (pNode) {
		var cs = [];

		do {
			var node = this._allocator.dereference(pNode, Node);
			var c = String.fromCharCode(node.getAsciiChar());
			cs.push(c);
			pNode = node.getParentPtr();
		} while (pNode !== 0);

		var encoded = cs.reverse().join("");
		return decodeURIComponent(encoded);
	};

	StringPool.prototype.insert = function (str) {
		var encoded = encodeURIComponent(str);

		var pNode = this._pRoot;
		for (var i = 0; i < encoded.length; ++i) {
			var c = encoded.charCodeAt(i);
			pNode = this._descend(pNode, c);
		}

		var node = this._allocator.dereference(pNode, Node);

		if (node.getParentPtr() === this._pRoot) {
			node.setParentPtr(0); // Not strictly needed, but this is an optimization for getString().
		}

		return pNode;
	};

	return StringPool;
})();




