

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
		this.offset = offset;
		this.type = type;
	};

	var Type = {
		U8 = 0,
		U32 = 1,
	};

	Type.getStride = function (type) {
		switch (type) {
			case 0: return 1;
			case 1: return 4;
		}
	};

	Type.getName = function (type) {
		switch (type) {
			case 0: return "Uint8";
			case 1: return "Uint32";
		}
	};

	var MetaMember = function (offset, typeName) {
		this.offset = offset;
		this.getType = "get" + typeName;
		this.setType = "set" + typeName;
	};

	var MetaStruct = function (memberNameToType) {
		var offset = 0;
		var memberName = Object.keys(obj);

		for (var i = 0; i < memberNames.length; ++i) {
			var memberName = memberNames[i];
			var type = memberNameToType[memberName];
			var typeName = Type.getName(type);

			this[memberName] = new MetaMember(offset, typeName);

			offset += Type.getStride(type);
		}

		this.SIZEOF = offset;
	};

	var createStructClass = function (memberNameToType) {
		var metaStruct = new MetaStruct(memberNameToType);

		var Instance = function (memory) {
			this._memory = memory;
		};

		Instance.SIZEOF = metaStruct.SIZEOF;

		var memberNames = Object.keys(metaStruct);

		for (var i = 0; i < memberNames.length; ++i) {
			var memberName = memberNames[i];
			var member = metaStruct[memberName];

			Instance.prototype["get" + memberName] = function () {
				return this._memory.view(member.offset)[member.getType]();
			};

			Instance.prototype["set" + memberName] = function (value) {
				this._memory.view(member.offset)[member.setType](value);
			};
		}

		return Instance;
	};

	var createListClass = function (type) {
		var Instance = function (memory) {
			this._memory = memory;
		};

		var stride = Type.getStride(type);
		var typeName = Type.getName(type);

		var getType = "get" + typeName;
		var setType = "set" + typeName;

		Instance.prototype.get = function (index) {
			return this._memory.view(index * stride)[getType]();
		};

		Instance.prototype.set = function (index, value) {
			this._memory.view(index * stride)[setType](value);
		};
	};

	var U32List = createListClass(Type.U32);

	var Node = createStructClass({
		AsciiChar: Type.U8,
		ParentPtr: Type.U32,
		KidCapacity: Type.U32,
		KidsPtr: Type.U32,
	});

	var StringPool = function () {
		this._allocator = new BufferedAllocator();
		this._pRoot = this._allocateNode(0, 0, 128);
	};

	StringPool.prototype._allocateNode = function (c, pParent, kidCapacity) {
		var kidByteCapacity = 4 * kidCapacity;

		var pNode = this._allocator.allocate(Node.SIZEOF);
		var pKids = this._allocator.allocate(kidByteCapacity); // Allocated after pNode to guarantee its pointer (!== 0).

		var node = this._allocator.dereference(pNode, Node);

		node.setAciiChar(c);
		node.setParentPtr(pParent);
		node.setKidCapacity(kidCapacity);
		node.setKidsPtr(pKids);

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




