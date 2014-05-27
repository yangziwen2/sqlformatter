var trimLeftRe = /^\(\s+/,
	trimRightRe = /\s+\)$/,
	andOrRe = /(?:\sand\s)|(?:\sor\s)/i;

/* 对sql中的括号进行分组 */
function splitBracketGroup(str, bracketContentArr, count){
	str = str.replace(trimLeftRe, '').replace(trimRightRe,'');
	var leftBracketPosStack = [];
	bracketContentArr = bracketContentArr || [];
	count || (count = 0);
	if(count == 0 && str[0] != '('){
		str = '((' + str.replace(/;\s*$/, '') + '))';	// 对应下面的leftPos == 0 -> continue;
	}
	for(var i=0; i<str.length; i++){
		if(str[i] == '('){
			leftBracketPosStack.push(i);
			continue;
		}
		if(str[i] == ')'){
			var leftPos = leftBracketPosStack.pop();
			if(leftPos == 0){
				continue;
			}
			var subGroupContent = str.substring(leftPos, i+1);
			var key = '#' + count + '#';
			bracketContentArr.push(subGroupContent.replace(trimLeftRe, '(').replace(trimRightRe, ')'));
			count ++;
			str = str.substring(0, leftPos) + key + str.substring(i+1);
			i -= i-leftPos;
			if(i == 0){
				continue;
			}
			splitBracketGroup(subGroupContent, bracketContentArr, count);
		}
	}
	return bracketContentArr;
}

/* 对select类型的语句进行正则匹配  */
function SelectMatcher(input) {
	this.sql = input;
}
SelectMatcher.prototype = {
	selRe: /^(?:\(select\s)(.+?)(?:\sfrom\s)(.+?)(?:(?:\swhere\s)(.+?))?(?:(?:\sgroup\sby\s)(.+?))?(?:(?:\shaving\s)(.+?))?(?:(?:\sorder\sby\s)(.+?))?(?:(?:\slimit\s)(.+?))?\)$/i,
	selectIdx: 0,
	fromIdx: 1,
	whereIdx: 2,
	groupIdx: 3,
	havingIdx: 4,
	orderIdx: 5,
	limitIdx: 6,
	match: function(){
		if(this.matchResult !== undefined){
			return this.matchResult;
		}
		var reResult = this.selRe.exec(this.sql);
		if(!reResult){
			this.matchResult = null;
			return null;
		}
		this.matchResult = Array.prototype.slice.apply(reResult, [1, 8])
		return this.matchResult;
	},
	formatResultAsArr: function(){
		if(this.formattedArr !== undefined){
			return this.formattedArr;
		}
		if(this.matchResult === undefined){
			this.match();
		}
		if(this.matchResult === null){
			this.formattedArr = null;
			return null;
		}
		var formattedArr = this.matchResult.slice();
		for(var i=0, l=formattedArr.length; i<l; i++){
			if(!formattedArr[i]){
				continue;
			}
			var subArr = [];
			if(i == this.selectIdx 
				|| i == this.fromIdx 
				|| i == this.groupIdx 
				|| i == this.orderIdx){
				subArr = formattedArr[i].split(/\s*,\s*/);
				for(var j=0, m=subArr.length; j<m; j++){
					subArr[j] = subArr[j].replace(trimLeftRe, '').replace(trimRightRe, '');
					if(j < m-1){
						subArr[j] += ','
					}
				}
			} else if (i == this.whereIdx || i == this.havingIdx){
				var clause = ' ' + formattedArr[i];
				var firstTurn = 1;
				for(var idx = clause.search(andOrRe); idx != -1; ){
					subArr.push(clause.substring(1, idx+1-firstTurn));
					clause = clause.substring(idx + 1 - firstTurn);
					idx = clause.substring(1).search(andOrRe);
					firstTurn = 0;
				}
				if(clause && clause.length > 0){
					subArr.push(clause.substring(1));
				}
			} else if(i == this.limitIdx){
				subArr.push(formattedArr[i]);
			} 
			formattedArr[i] = subArr;
		}
		this.formattedArr = formattedArr;
		return formattedArr;
	},
	toString: function(depth){
		if(this.formattedArr === undefined){
			this.formatResultAsArr();
		}
		if(this.formattedArr === null){
			return this.sql;
		}
		depth || (depth = 1);
		var indentNum = depth;
		var indent = '';
		for(var i=0; i<indentNum-1; i++){
			indent += '  ';
		}
		var baseIndent = indent;
		indent = indent + '  ';
		var sqlArr = [];
		depth > 1 && (sqlArr.push('('));
		for(var i=0, l=this.formattedArr.length; i<l; i++){
			if(!this.formattedArr[i]){
				continue;
			}
			if(i != 0){
				sqlArr.push('\n');
				sqlArr.push(baseIndent);
			}
			sqlArr.push(this.getClauseName(i));
			var m = this.formattedArr[i].length || 0;
			for(var j=0; j<m; j++ ){
				sqlArr.push('\n');
				sqlArr.push(indent);
				sqlArr.push(this.formattedArr[i][j]);
			}
		}
		depth > 1 && (sqlArr.push(')'));
		return sqlArr.join('');;
	},
	getClauseName: function(clauseIdx){
		if(!clauseIdx && clauseIdx !== 0){
			return '';
		}
		switch(clauseIdx){
			case this.selectIdx: 
				return 'select';
			case this.fromIdx:
				return 'from';
			case this.whereIdx:
				return 'where';
			case this.groupIdx:
				return 'group by';
			case this.havingIdx:
				return 'having';
			case this.orderIdx:
				return 'order by';
			case this.limitIdx:
				return 'limit';
			default:
				return '';
		}
	}
}

/* 根据匹配的结果重新构造sql */
function reformSql(smArr){
	if(!smArr || !smArr.length){
		return '';
	}
	var depth = 1,
		lastIdx = smArr.length - 1;
	return smArr[lastIdx].toString(depth).replace(/#(\d+?)#/g, replacePlaceHolder);
	function replacePlaceHolder(placeholder, idx, pos, str){
		depth +=2;
		var result = smArr[idx].toString(depth).replace(/#(\d+?)#/g, arguments.callee);
		depth -=2;
		return result;
	}
}

/* 格式化select类型的sql */
function formatSelectSql(sql){
	var bracketGroup = splitBracketGroup(sql);
	if(!bracketGroup || !bracketGroup.length){
		return sql;
	}
	for(var i=0, smArr = []; i<bracketGroup.length; i++){
		smArr.push(new SelectMatcher(bracketGroup[i]));
	}
	var formattedSql = reformSql(smArr);
	return formattedSql? formattedSql + ';': sql;
}

/* 格式化update类型的sql，如果set后面的内容中有","存在于字符串中，就会出问题 */
function formatUpdateSql(sql){
	var updateRe = /^\s*update\s+(.+?)\s+set\s+(.+?)(?:\s+where\s+(.+))?$/;
	var reResult = updateRe.exec(sql);
	if(!reResult){
		return sql;
	}
	var matchResult = Array.prototype.slice.apply(reResult,[1, 4]);
	var whereClause = '',
		indent = '  ';
	if(matchResult.length > 2 && matchResult[2]){
		whereClause = formatSelectSql('select 1 from 1 where ' + matchResult[2]);
	}
	var setArr = matchResult[1].split(',');
	for(var i=0, l=setArr.length; i<l; i++){
		setArr[i] = setArr[i].replace(/^\s+/, '');
	}
	return 'update\n' + indent + matchResult[0] + '\nset\n' + indent + setArr.join(',\n' + indent) + '\n' 
		+ (whereClause && whereClause.substring(20));
}

/* 目前只粗糙的支持update和select */
function formatSql(sql){
	sql = sql.replace(trimLeftRe, '');
	var sqlPrefix = sql.substring(0, 6).toLowerCase();
	if(sqlPrefix == 'update') {
		return formatUpdateSql(sql);
	} else if (sqlPrefix == 'select') {
		return formatSelectSql(sql);
	}
	return sql;
}
