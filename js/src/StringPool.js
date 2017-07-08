

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

	var OffsetBuffer = function (buffer, offset) {
		this._buffer = buffer;
		this._offset = offset;
	};

	OffsetBuffer.prototype.view = function (offset) {
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

	LinearAllocator.prototype.dereference = function (p) {
		return new OffsetBuffer(this._buffer, p);
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

	BufferedAllocator.prototype.dereference = function (p) {
		var index = lowerBound(p, this._offsets);
		p -= this._offsets[index];
		return this._allocators[index].dereference(p);
	};

	var Node = {
		asciiChar: 0,
		parentPtr: 1,
		kidCapacity: 5,
		kidsPtr: 9,
		SIZEOF: 15
	};

	var StringPool = function () {
		this._allocator = new BufferedAllocator();
		this._pRoot = this._allocateNode(0, 0, 128);
	};

	StringPool.prototype._allocateNode = function (c, parent, kidCapacity) {
		var kidByteCapacity = 4 * kidCapacity;

		var pNode = this._allocator.allocate(Node.SIZEOF);
		var pKids = this._allocator.allocate(kidByteCapacity); // Must be allocated after pNode to guarantee its pointer (!== 0).

		var node = this._allocator.dereference(pNode);
		node.view(Node.aciiChar).setUint8(c);
		node.view(Node.parentPtr).setUint32(parent);
		node.view(Node.kidCapacity).setUint32(kidCapacity);
		node.view(Node.kidsPtr).setUint32(pKids);

		var kids = this._allocator.dereference(pKids);
		for (var offset = 0; offset < kidByteCapacity; offset += 4) {
			kids.view(offset).setUint32(0);
		}
	};

	StringPool.prototype._kidsSize = function (node, kids) {
		var kids = this._allocator.dereference(pKids);

		var kidCapacity = node.view(Node.kidCapacity).getUint32();

		var prevLower = 0;
		var lower = 0;
		var upper = kidCapacity;

		while (lower < upper) {
			var dist = upper - lower;
			var pivot = lower + Math.floor(dist / 2);
			var pKid = kids.view(pivot).getUint32();
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
		var node = this._allocator.dereference(pNode);
		var pKids = node.view(Node.kidsPtr).getUint32();
		var kids = this._allocator.dereference(pKids);

		var kidsSize = this._kidsSize(node, kids);

		var lower = 0;
		var upper = kidsSize;
		while (lower < upper) {
			var dist = upper - lower;
			var pivot = lower + Math.floor(dist / 2);
			var pKid = kids.view(pivot);
			var kid = this._allocator.dereference(pKid);
			var k = kid.view(Node.asciiChar).getUint8();
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

		var kidCapacity = node.view(Node.kidCapacity).getUint32();
		if (kidSize >= kidCapacity) {
			var oldByteCapacity = 4 * kidCapacity;
			var newByteCapacity = 2 * oldByteCapacity;

			var pNewKids = this._allocator.allocate(newByteCapacity);
			var newKids = this._allocator.dereference(pNewKids);

			for (var offset = 0; offset < oldByteCapacity; i += 4) {
				newKids.view(offset).setUint32(kids.view(offset).getUint32());
			}
			for (var offset = oldByteCapacity; offset < newByteCapacity; offset += 4) {
				kids.view(offset).setUint32(0);
			}

			pKids = pNewKids;
			kids = newKids;
			node.view(Node.kidsPtr).setUint32(pKids);
		}

		var lowerOffset = 4 * lower;
		var pKid = this._allocateNode(c, pNode, 4);
		for (var offset = 4 * (kidsSize - 1); offset >= lowerOffset; offset -= 4) {
			kids.view(offset + 4).setUint32(kids.view(offset).getUin32());
		}
		kids.view(lowerOffset).setUint32(pKid);

		return pKid;
	};

	StringPool.prototype.getString = function (pNode) {
		var cs = [];

		do {
			var node = this._allocator.dereference(pNode);
			var c = node.view(Node.asciiChar).getUint8();
			cs.push(c);
			pNode = node.view(Node.parentPtr).getUint32();
		} while (pNode !== 0);

		var encoded = cs.reverse().join("");
		return decodeURIComponent(encoded);
	};

	StringPool.prototype.insert = function (str) {
		var encoded = encodeURIComponent(str);
		var pNode = this._pRoot;
		for (var i = 0; i < str.length; ++i) {
			var c = str.charAt(i);
			pNode = this._descend(pNode, c);
		}

		var node = this._allocator.dereference(pNode);
		var parent = node.view(Node.parentPtr);
		if (parent.getUint32() === this._pRoot) {
			parent.setUint32(0); // Not strictly needed, but this is an optimization for toString().
		}

		return pNode;
	};

	return StringPool;
})();




