

var StringPool = (function () {

	var PooledString = function (c, parent) {
		this._c = c;
		this._relatives = [parent]; // [0] => parent ; [N > 0] => child
		this._active = false;
	};

	PooledString.prototype._descend = function (c) {
		var lower = 1;
		var upper = this._relatives.length;
		while (lower < upper) {
			var dist = upper - lower;
			var pivot = lower + Math.floor(dist / 2);
			var child = this._relatives[pivot];
			if (c < child._c) {
				upper = pivot;
			}
			else if (c > child._c) {
				lower = Math.max(lower + 1, pivot);
			}
			else {
				return child;
			}
		}
		var node = new PooledString(c, this);
		this._relatives.splice(lower, 0, node);
		return node;
	};

	PooledString.prototype.toString = function () {
		var cs = [];
		var curr = this;
		do {
			cs.push(this._c);
			curr = curr._relatives[0];
		} while (curr !== null);
		return cs.reverse().join("");
	};

	var StringPool = function () {
		this._root = new PooledString("", null);
	};

	StringPool.prototype.insert = function (str) {
		var curr = this._root;
		for (var i = 0; i < str.length; ++i) {
			var c = str.charAt(i);
			var curr = curr._descend(c);
		}
		if (curr._relatives[0] === this._root) {
			curr._relatives[0] = null; // Not strictly needed, but this is an optimization for toString().
		}
		curr._active = true;
		return curr;
	};

	return StringPool;
})();




