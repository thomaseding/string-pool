

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

	LinearAllocator.prototype.dereference = function (p, clazz) {
		return new clazz(new Memory(this._buffer, p));
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

	BufferedAllocator.prototype.dereference = function (p, clazz) {
		var index = lowerBound(p, this._offsets);
		p -= this._offsets[index];
		return this._allocators[index].dereference(p, clazz);
	};


	var Type = function (name, sizeof) {
		if (sizeof < 0) {
			sizeof = -1;
		}
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
	

	var StructType = function (clazz, name, sizeof) {
		Type.call(this, name, sizeof);
		this.clazz = clazz;
	};

	StructType.prototype = new Type();
	StructType.prototype.constructor = StructType;
	

	var ListType = function (clazz, elemType, count) {
		var name = elemType.name + "_" + (count < 0 ? "Z" : count);
		var sizeof = elemType.sizeof * count;
		Type.call(this, name, sizeof);
		this.clazz = clazz;
	};

	ListType.prototype = new Type();
	ListType.prototype.constructor = ListType;


	var Member = function (offset, type) {
		this.offset = offset;
		this.type = type;
	};


	var StructInfo = function (memberNameToType) {
		var offset = 0;
		var memberName = Object.keys(obj);

		for (var i = 0; i < memberNames.length; ++i) {
			var memberName = memberNames[i];
			var type = memberNameToType[memberName];
			if (!(type instanceof Type) || type.sizeof < 0) {
				throw Error();
			}

			this[memberName] = new Member(offset, type.name);
			offset += type.sizeof;
		}

		this.sizeof = offset;
	};


	var createStructType = function (name, memberNameToType) {
		var structInfo = new StructInfo(memberNameToType);

		var Class = function (memory) {
			this._memory = memory;
		};

		var type = new StructType(Class, structInfo.sizeof, name);

		var memberNames = Object.keys(structInfo);

		for (var i = 0; i < memberNames.length; ++i) {
			var memberName = memberNames[i];
			var member = structInfo[memberName];

			if (member.type.constructor === NativeType) {
				Class.prototype[memberName] = (function (member) {
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
				Class.prototype[memberName] = (function (member) {
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

		return type;
	};


	var createListClass = function (elemType, compileTimeCount) {
		if (compileTimeCount === undefined) {
			compileTimeCount = -1;
		}
		
		var Class = function (memory) {
			this._memory = memory;
		};

		var type = new ListType(Class, elemType, compileTimeCount);

		if (elemType.constructor === NativeType) {
			Class.prototype.at = function (index) {
				var offset = elemType.sizeof * index;
				var view = this._memory.view(offset);
				return {
					get: function () {
						var offset = index * elemType.sizeof;
						return view[elemType.viewGet]();
					},
					set: function (value) {
						var offset = index * elemType.sizeof;
						view[elemType.viewSet](value);
					},
				};
			};

		}
		else if (elemType.constructor === StructType || elemType.constructor === ListType) {
			if (elemType.sizeof < 0) {
				throw Error();
			}
			Class.prototype.at = function (index) {
				var offset = elemType.sizeof * index;
				var elemMemory = this._memory.atOffset(index);
				return new elemType.clazz(elemMemory);
			};
		}
		else {
			throw Error();
		}

		return type;
	};


	var Uint8 = new NativeType("Uint8", 1);
	var Uint32 = new NativeType("Uint32", 4);

	var U32List = createListClass(Uint32);

	var Node = createStructClass("Node", {
		asciiChar: Uint8,
		parentPtr: Uint32,
		kidCapacity: Uint32,
		kidsPtr: Uint32,
	});


	var StringPool = function () {
		this._allocator = new BufferedAllocator();
		this._pRoot = this._createNode(0, 0, 0);
	};

	StringPool.prototype._allocate = function (byteCount) {
		return this._allocator.allocate(byteCount);
	};

	StringPool.prototype._dereference = function (p, clazz) {
		return this._allocator.dereference(p, clazz);
	};

	StringPool.prototype._createNode = function (c, pParent, depth) {
		var kidCapacity;
		switch (depth) {
			case 0:
				kidCapacity = 128;
				break;
			case 1:
				kidCapacity = 32;
				break;
			case 2:
				kidCapacity = 8;
				break;
			default:
				if (depth < 16) {
					kidCapacity = 4;
				}
				else if (depth < 32) {
					kidCapacity = 2;
				}
				else {
					kidCapacity = 1;
				}
		}

		var kidByteCapacity = 4 * kidCapacity;

		var pNode = this._allocate(Node.sizeof);
		var pKids = this._allocate(kidByteCapacity); // Intentionally allocated after pNode to guarantee its pointer (!== 0).

		var node = this._dereference(pNode, Node);

		node.aciiChar().set(c);
		node.parentPtr().set(pParent);
		node.kidCapacity().set(kidCapacity);
		node.kidsPtr().set(pKids);

		var kids = this._dereference(pKids, U32List);
		for (var i = 0; i < kidCapacity; ++i) {
			kids.at(i).set(0);
		}

		return pNode;
	};

	StringPool.prototype._kidsSize = function (node, kids) {
		var kids = this._dereference(pKids, U32List);

		var kidCapacity = node.kidCapacity().get();

		var prevLower = 0;
		var lower = 0;
		var upper = kidCapacity;

		while (lower < upper) {
			var dist = upper - lower;
			var pivot = lower + Math.floor(dist / 2);
			var pKid = kids.at(pivot).get();
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

	StringPool.prototype._descend = function (pNode, c, depth) {
		var node = this._dereference(pNode, Node);
		var kidsPtr = node.kidsPtr();
		var kids = this._dereference(kidsPtr.get(), U32List);

		var kidsSize = this._kidsSize(node, kids);

		var lower = 0;
		var upper = kidsSize;
		while (lower < upper) {
			var dist = upper - lower;
			var pivot = lower + Math.floor(dist / 2);
			var pKid = kids.at(pivot).get();
			var kid = this._dereference(pKid, Node);
			var k = kid.asciiChar().get();
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

		var kidCapacity = node.kidCapacity().get();
		if (kidSize >= kidCapacity) {
			var newCapacity = 2 * kidCapacity;
			var newByteCapacity = 4 * newCapacity;

			var pNewKids = this._allocate(newByteCapacity);
			var newKids = this._dereference(pNewKids, U32List);

			for (var i = 0; i < kidCapacity; ++i) {
				var p = kids.at(i).get();
				newKids.at(i).set(p);
			}
			for (var i = kidCapacity; offset < newCapacity; ++i) {
				kids.at(i).set(0);
			}

			kids = newKids;
			kidsPtr.set(pNewKids);
		}

		var pKid = this._createNode(c, pNode, depth);
		for (var i = kidsSize - 1; i >= lower; --i) {
			var p = kids.at(i).get();
			kids.at(i + 1).set(p);
		}
		kids.at(lower).set(pKid);

		return pKid;
	};

	StringPool.prototype.getString = function (pNode) {
		var cs = [];

		do {
			var node = this._dereference(pNode, Node);
			var c = String.fromCharCode(node.asciiChar().get());
			cs.push(c);
			pNode = node.parentPtr().get();
		} while (pNode !== 0);

		var encoded = cs.reverse().join("");
		return decodeURIComponent(encoded);
	};

	StringPool.prototype.insert = function (str) {
		var encoded = encodeURIComponent(str);

		var pNode = this._pRoot;
		var i = 0;
		while (i < encoded.length) {
			var c = encoded.charCodeAt(i);
			pNode = this._descend(pNode, c, ++i);
		}

		var node = this._dereference(pNode, Node);

		var parentPtr = node.getParentPtr();
		if (parentPtr.get() === this._pRoot) {
			parentPtr.set(0); // Not strictly needed, but this is an optimization for getString().
		}

		return pNode;
	};

	return StringPool;
})();




