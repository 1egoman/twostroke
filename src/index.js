const LOWER_WORD_BOUNDARY = /\W/;
const UPPER_WORD_BOUNDARY = /\s/;

function getIndexFromRowCol(text, row, col) {
  let total = 0;
  const rows = text.split('\n');

  for (let index = 0; index < row; index++) {
    total += (rows[index] || '').length + 1;
  }

  return total + col;
}
function getRowColFromIndex(text, index) {
  let row = 0, col = 0;

  for (let i = 0; i < index; i++) {
    if (text[i] === '\n') {
      row += 1;
      col = 0;
    } else {
      col += 1;
    }
  }

  return {row, col};
}

function addToHistoricalRegisters(state, content) {
  for (let register = 9; register >= 0; register -= 1) {
    const currentRegister = `${register}`;
    const previousRegister = `${register-1}`;
    if (state.registers[previousRegister]) {
      state.registers[currentRegister] = state.registers[previousRegister];
    }
  }
  if (state.registers['"']) {
    state.registers['0'] = state.registers['"'];
  }
  state.registers['"'] = content;
}

function getIndexOfEndOfRow(text, row) {
  const rows = text.split('\n');
  if (rows[row]) {
    let total = 0;
    for (let i = 0; i <= row; i++) {
      total += rows[i].length;
      total += 1; // '\n'
    }
    return total-1;
  } else {
    return null;
  }
}

function getIndexOfStartOfRow(text, row) {
  const rows = text.split('\n');
  if (rows[row]) {
    let total = 0;
    for (let i = 0; i < row; i++) {
      total += rows[i].length;
      total += 1; // '\n'
    }
    return total;
  } else {
    return null;
  }
}

function findWords(text, uppercase=false) {
  const BOUNDARY = uppercase ? /\s/ : /\W/;

  const words = [];
  let lastIndex = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (BOUNDARY.test(char)) {
      // "5"
      const word = text.slice(lastIndex, i);
      const index = words.length === 0 ? lastIndex : lastIndex+1;
      words.push({ word, index });

      // "."
      const seperator = text[i];
      words.push({word: seperator, index: i, endIndex: i});

      lastIndex = i;
    }
  }

  // Add final word
  words.push({
    word: text.slice(lastIndex+1),
    index: lastIndex+1,
  });

  return words
    .map(w => Object.assign({}, w, {word: w.word.trim()}))
    .map(w => Object.assign({}, w, {endIndex: w.index + w.word.length - 1}))
    .filter(w => w.word.length > 0);
}

function applyEditingOperation(text, state, startIndex, endIndex) {
  const originalStartIndex = startIndex, originalEndIndex = endIndex;
  let swapped = false;

  // Swap start and end index if end is before start
  if (startIndex > endIndex) {
    const swap = endIndex;
    endIndex = startIndex-1;
    startIndex = swap;
    swapped = true;
  }

  if (state.modifier === 'inside') {
    while (/^\w$/.test(text[startIndex-1])) {
      startIndex -= 1;
    }
    while (/^\w$/.test(text[endIndex+1])) {
      endIndex += 1;
    }
  } else if (state.modifier === 'around') {
    while (/^\w$/.test(text[startIndex-1])) {
      startIndex -= 1;
    }
    while (/^\w$/.test(text[endIndex+1])) {
      endIndex += 1;
    }
  }

  switch (state.operation) {
  case 'change':
    state.mode = 'insert';
    state.insertAppend = true;
  case 'delete':
    addToHistoricalRegisters(
      state,
      text.slice(
        startIndex,
        endIndex,
      )
    );
    text = text.slice(0, startIndex) + text.slice(endIndex+1);
    break;
  case 'yank':
    const data = text.slice(startIndex, endIndex);
    addToHistoricalRegisters(state, data);

    // If a custom register was set with ", then add to that register too.
    if (state.register) {
      state.registers[state.register] = data;
    }
    pushHistoryState(state, text);
    break;
  default:
    // No operation - movement
    const result = getRowColFromIndex(text, originalEndIndex);
    state.row = result.row;
    state.col = result.col;
    break;
  }

  // If the start and end index were swapped, then move to the start.
  if (swapped) {
    const result = getRowColFromIndex(text, startIndex);
    state.row = result.row;
    state.col = result.col;
  }

  return {state, text};
}

function pushHistoryState(state, text) {
  const stateCopyWithoutSomeFields = Object.assign({}, state);

  delete stateCopyWithoutSomeFields.operation;
  delete stateCopyWithoutSomeFields.mode;
  delete stateCopyWithoutSomeFields.registers;
  delete stateCopyWithoutSomeFields.marks;
  delete stateCopyWithoutSomeFields.history;
  delete stateCopyWithoutSomeFields.historyIndex;
  delete stateCopyWithoutSomeFields.insertAppend;

  // Don't push a history state if the new text+state is the same as the previous.
  if (
    state.history.length > 0 &&
    state.history[state.history.length-1].text === text &&
    JSON.stringify(state.history[state.history.length-1].state) ===
    JSON.stringify(stateCopyWithoutSomeFields)
  ) {
    return false;
  }

  if (state.historyIndex !== null) {
    // Remove history states after the current one, since they've now "diverged"
    // Vim doesn't actually do this but that's a task for another day.
    state.history = state.history.slice(0, state.historyIndex+1);
  }

  state.history.push({
    text,
    state: stateCopyWithoutSomeFields,
  });

  if (state.historyIndex == null) {
    state.historyIndex = 0; // Initial set
  } else {
    state.historyIndex += 1;
  }
  return true;
}

module.exports = function twostroke(text, state, commands) {
  if (!state) {
    state = {
      mode: 'normal',

      row: 0,
      col: 0,

      registers: {},
      marks: {},

      history: [],
      historyIndex: null,
    };
    pushHistoryState(state, text);
  }
  if (typeof commands === 'string') {
    commands = commands.split('');
  }

  // Make a copy of `state`
  state = Object.assign({}, state);

  commands.forEach(command => {
    // If a command occurs while recording, add it into the register.
    if (state.recordIntoRegister) {
      state.registers[state.recordIntoRegister] += command;
    }

    switch (true) {
      case command === 'esc' || command === 'ctrl-c' || command === 'escape':
        state.mode = 'normal';
        if (state.insertAppend) { state.col -= 1; }

        delete state.insertAppend;
        delete state.operation;
        delete state.register;
        delete state.insertFromChange;
        break;

      // The second half of typing " (register name) to set the given register as current
      case state.last === 'set-register':
        state.register = command;
        delete state.last;
        break;

      // The second half of typing m (mark name) to set the mark position
      case state.last === 'set-mark':
        state.marks[command] = {
          row: state.row,
          col: state.col,
        };
        delete state.last;
        break;

      // The third part of typing d m (mark name) to delete a mark
      case state.last === 'delete-mark':
        delete state.marks[command];
        delete state.last;
        break;

      // The second part of typing f (char) to find a character on the current line
      case state.last === 'find-char': {
        const rows = text.split('\n');
        state.semicolonCommaJumpCharacter = command;
        state.semicolonCommaJumpType = 'find';

        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          const startSearchIndex = state.searchDirection === 'FORWARDS' ? state.col + 1 : 0;
          const endSearchIndex = state.searchDirection === 'FORWARDS' ? rows[state.row].length : state.col - 1;
          const needle = rows[state.row].slice(startSearchIndex, endSearchIndex);

          // Find the next index of the char the user typed
          const needleIndex = state.searchDirection === 'FORWARDS' ? needle.indexOf(command) : needle.lastIndexOf(command);
          if (needleIndex === -1) {
            // Char not in the line
            delete state.last;
            break;
          }
          let colIndex = startSearchIndex + needleIndex;

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            getIndexFromRowCol(text, state.row, colIndex),
          );
          state = resp.state;
          text = resp.text;
        }

        delete state.operation;
        delete state.last;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }

      // The second part of typing t (char) to move up to a char on the current line
      case state.last === 'to-char': {
        const rows = text.split('\n');
        state.semicolonCommaJumpCharacter = command;
        state.semicolonCommaJumpType = 'to';

        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          const startSearchIndex = state.searchDirection === 'FORWARDS' ? state.col + 1 : 0;
          const endSearchIndex = state.searchDirection === 'FORWARDS' ? rows[state.row].length : state.col - 1;
          const needle = rows[state.row].slice(startSearchIndex, endSearchIndex);

          // Find the next index of the char the user typed
          const needleIndex = state.searchDirection === 'FORWARDS' ? needle.indexOf(command) : needle.lastIndexOf(command);
          if (needleIndex === -1) {
            // Char not in the line
            delete state.last;
            break;
          }
          let colIndex = startSearchIndex + needleIndex + (state.searchDirection === 'FORWARDS' ? -1 : 1);

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            getIndexFromRowCol(text, state.row, colIndex),
          );
          state = resp.state;
          text = resp.text;
        }

        delete state.operation;
        delete state.last;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }

      // The second part of typing r (char) to replace a character with another character
      case state.last === 'replace-char': {
        pushHistoryState(state, text);
        const index = getIndexFromRowCol(text, state.row, state.col);
        text = text.slice(0, index) + command + text.slice(index+1);
        delete state.last;
        break;
      }

      // The second half of typing ' (mark name) to jump to a mark
      case state.last === 'mark-movement':
        const mark = state.marks[command];
        if (!mark) { break; }

        delete state.last;

        const resp = applyEditingOperation(
          text,
          state,
          getIndexFromRowCol(text, state.row, state.col),
          getIndexFromRowCol(text, mark.row, mark.col),
        );
        state = resp.state;
        text = resp.text;
        break;

      // The second half of q (register name) to record key commands into a register
      case state.last === 'set-recording-register':
        state.recordIntoRegister = command;
        state.registers[command] = ''; /* clear register */
        delete state.last;
        break;

      // The second half of @ (register name) to playback a register
      case state.last === 'set-playback-register': {
        delete state.last;

        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          // Recurse here, this permits looping
          const resp = twostroke(text, state, state.registers[command]);
          state = resp.state;
          text = resp.text;
        }
        delete state.operationIterations;
        break;
      }

      // When in insert mode, add at the current cursor position.
      case state.mode === 'insert':
        const index = getIndexFromRowCol(text, state.row, state.col);

        if (command === 'backspace') {
          if (index > 0) {
            text = `${text.slice(0, index-1)}${text.slice(index)}`;
            state.col -= 1;
          }

        } else if (command.charCodeAt(0) === 13 || command === 'enter') {
          let endWhitespaceIndex = getIndexOfStartOfRow(text, state.row), whitespaceMatch, colIndex = 0;

          // Figure out how many whitespace characters are at the start of the current row
          let whitespace = '';
          while (whitespaceMatch = /^(\s)$/.exec(text[endWhitespaceIndex])) {
            endWhitespaceIndex += 1;
            whitespace += whitespaceMatch[1];
            colIndex += 1;
          }
          text = `${text.slice(0, index)}\n${whitespace}${text.slice(index)}`;
          state.col = colIndex;
          state.row += 1;

        } else if (text.length-1 < index) {
          text += command;
          state.col += 1;
        } else {
          text = `${text.slice(0, index)}${command}${text.slice(index)}`;
          state.col += 1;
        }

        state.registers['.'] = text;
        break;

      // When in command mode, add to the command buffer.
      case state.mode === 'command' && command.charCodeAt(0) !== 13: {
        if (command === 'backspace') {
          if (state.commandCursorIndex > 0) {
            state.commandQuery = `${state.commandQuery.slice(0, state.commandCursorIndex-1)}${state.commandQuery.slice(state.commandCursorIndex)}`;
            state.commandCursorIndex -= 1;
          }

        } else if (text.length-1 < state.commandCursorIndex) {
          state.commandQuery += command;
          state.commandCursorIndex += 1;
        } else {
          state.commandQuery = `${state.commandQuery.slice(0, state.commandCursorIndex)}${command}${state.commandQuery.slice(state.commandCursorIndex)}`;
          state.commandCursorIndex += 1;
        }
        break;
      }
      case state.mode === 'command' && command.charCodeAt(0) === 13: {
        delete state.commandCursorIndex;
        state.mode = 'normal';

        console.log('COMMAND ISSUED!', state.commandQuery);
        delete state.commandQuery;
        break;
      }

      // When in search mode, add to the search buffer.
      case state.mode === 'search' && command.charCodeAt(0) !== 13: {
        if (command === 'backspace') {
          if (state.searchCursorIndex > 0) {
            state.searchQuery = `${state.searchQuery.slice(0, state.searchCursorIndex-1)}${state.searchQuery.slice(state.searchCursorIndex)}`;
            state.searchCursorIndex -= 1;
          }

        } else if (text.length-1 < state.searchCursorIndex) {
          state.searchQuery += command;
          state.searchCursorIndex += 1;
        } else {
          state.searchQuery = `${state.searchQuery.slice(0, state.searchCursorIndex)}${command}${state.searchQuery.slice(state.searchCursorIndex)}`;
          state.searchCursorIndex += 1;
        }
        break;
      }

      // When leaving search mode, perform the first search.
      case state.mode === 'search' && command.charCodeAt(0) === 13:
        delete state.searchCursorIndex;
        state.mode = 'normal';

        if (state.searchQuery.length === 0) {
          // Not typing anything after pressing / should act like the user pressed `n`.
          state.searchQuery = new RegExp(state.registers['/']);
        } else {
          // The user typed a new search query
          state.registers['/'] = state.searchQuery;
          state.searchQuery = new RegExp(state.searchQuery);
          state.initialSearch = true;
        }

      case state.initialSearch || command === 'n': {
        if (!state.searchQuery) { break; }

        let startIndex = getIndexFromRowCol(text, state.row, state.col);
        if (!state.initialSearch) {
          // For the initial search, start after the current cursor position.
          startIndex += 1;
        }
        delete state.initialSearch; /* unset the flag */

        // First, look for the match from the cursor position to the end of the buffer.
        const haystack = text.slice(startIndex);
        let match = state.searchQuery.exec(haystack);
        if (match) {
          state.searchMatchFound = true;
          state.searchMatchWrappedAround = false;
          state.searchMatchStartIndex = startIndex + match.index;
          state.searchMatchEndIndex = state.searchMatchStartIndex + match[0].length;

          // HACK: if performing an edit operation, edit up until the match, not over the first
          // character of the match.
          if (state.operation) {
            state.searchMatchStartIndex -= 1;
          }

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            state.searchMatchStartIndex,
          );
          state = resp.state;
          text = resp.text;
          break;
        }

        // Then, look for the match throughout the whole buffer, and if found, then set a flag
        // indicated that we wrapped around.
        match = state.searchQuery.exec(text);
        if (match) {
          state.searchMatchFound = true;
          state.searchMatchWrappedAround = true;
          state.searchMatchStartIndex = match.index;
          state.searchMatchEndIndex = state.searchMatchStartIndex + match[0].length;

          // HACK: if performing an edit operation, edit up until the match, not over the first
          // character of the match.
          if (state.operation) {
            state.searchMatchStartIndex -= 1;
          }

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            state.searchMatchStartIndex,
          );
          state = resp.state;
          text = resp.text;
          break;
        }

        // Match was not found.
        state.searchMatchFound = false;
        delete state.searchMatchWrappedAround;
        delete state.searchMatchStartIndex;
        delete state.searchMatchEndIndex;
        break;
      }

      case command === 'g': {
        if (state.last === 'g-prefix') {
          // Move to top
          delete state.last;
          state.row = 0;
          state.col = 0;

          while (/^\s$/.test(text[getIndexFromRowCol(text, state.row, state.col)])) {
            state.col += 1;
          }
        } else {
          state.last = 'g-prefix';
        }
        break;
      }

      case command === 'G': {
        let newRow = state.row, newCol = state.col;
        const rows = text.split('\n');
        if (state.operationIterations) {
          // Goto a line
          newRow = state.operationIterations - 1;

          // Move to the right side of the line depending on which way the cursor is coming from
          if (newRow > state.row) {
            newCol = 0;
          } else {
            newCol = rows[newRow].length;
          }

          delete state.operationIterations;
        } else {
          // Go to end of file
          newRow = rows.length - 1;
          newCol = rows[newRow].length - 1;
        }

        if (newRow > rows.length-1) {
          newRow = rows.length - 1;
        }

        if (!state.operation) {
          // Move to first col char that isn't whitespace.
          newCol = 0;
          while (/^\s$/.test(text[getIndexFromRowCol(text, newRow, newCol)])) {
            newCol += 1;
          }
        }

        const resp = applyEditingOperation(
          text,
          state,
          getIndexFromRowCol(text, state.row, state.col),
          getIndexFromRowCol(text, newRow, newCol),
        );
        state = resp.state;
        text = resp.text;
        break;
      }

      case command === 'N': {
        if (!state.searchQuery) { break; }
        let startIndex = getIndexFromRowCol(text, state.row, state.col);

        // First, look for the match from the cursor position to the end of the buffer.
        const haystack = text.slice(0, startIndex);
        const needle = new RegExp(`[^]*(${state.searchQuery.source})`);
        let match = needle.exec(haystack);
        if (match) {
          state.searchMatchFound = true;
          state.searchMatchWrappedAround = false;
          state.searchMatchStartIndex = haystack.lastIndexOf(match[1]);
          state.searchMatchEndIndex = state.searchMatchStartIndex + match[1].length

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            state.searchMatchStartIndex,
          );
          state = resp.state;
          text = resp.text;
          return;
        }

        // Then, look for the match throughout the whole buffer, and if found, then set a flag
        // indicated that we wrapped around.
        match = needle.exec(text);
        if (match) {
          state.searchMatchFound = true;
          state.searchMatchWrappedAround = true;
          state.searchMatchStartIndex = text.lastIndexOf(match[1]);
          state.searchMatchEndIndex = state.searchMatchStartIndex + match[1].length

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            state.searchMatchStartIndex,
          );
          state = resp.state;
          text = resp.text;
          return;
        }

        // Match was not found.
        state.searchMatchFound = false;
        delete state.searchMatchWrappedAround;
        delete state.searchMatchStartIndex;
        delete state.searchMatchEndIndex;
        break;
      }

      case command === ';': {
        const rows = text.split('\n');

        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          let startSearchIndex = state.searchDirection === 'FORWARDS' ? state.col + 1 : 0;
          // If moving "to", then adjust the start point as to not match the current character.
          if (state.searchDirection === 'FORWARDS' && state.semicolonCommaJumpType === 'to') {
            startSearchIndex += 1;
          }
          const endSearchIndex = state.searchDirection === 'FORWARDS' ? rows[state.row].length : state.col;
          const needle = rows[state.row].slice(startSearchIndex, endSearchIndex);

          // Find the next index of the char the user typed
          const needleIndex = state.searchDirection === 'FORWARDS' ?
            needle.indexOf(state.semicolonCommaJumpCharacter) :
            needle.lastIndexOf(state.semicolonCommaJumpCharacter);
          if (needleIndex === -1) {
            // Char not in the line
            break;
          }
          let colIndex = startSearchIndex + needleIndex;

          // If moving "to", then move to a character before / after target character depending on
          // movement direction.
          if (state.semicolonCommaJumpType === 'to') {
            colIndex += (state.searchDirection === 'FORWARDS' ? -1 : 1);
          }

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            getIndexFromRowCol(text, state.row, colIndex),
          );
          state = resp.state;
          text = resp.text;
        }

        delete state.operation;
        delete state.last;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }

      case command === ',': {
        const rows = text.split('\n');
        const oppositeDirection = state.searchDirection === 'FORWARDS' ? 'BACKWARDS' : 'FORWARDS';

        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          let startSearchIndex = oppositeDirection === 'FORWARDS' ? state.col + 1 : 0;
          // If moving "to", then adjust the start point as to not match the current character.
          if (oppositeDirection === 'FORWARDS' && state.semicolonCommaJumpType === 'to') {
            startSearchIndex += 1;
          }
          const endSearchIndex = oppositeDirection === 'FORWARDS' ? rows[state.row].length : state.col;
          const needle = rows[state.row].slice(startSearchIndex, endSearchIndex);

          // Find the next index of the char the user typed
          const needleIndex = oppositeDirection === 'FORWARDS' ?
            needle.indexOf(state.semicolonCommaJumpCharacter) :
            needle.lastIndexOf(state.semicolonCommaJumpCharacter);
          if (needleIndex === -1) {
            // Char not in the line
            break;
          }
          let colIndex = startSearchIndex + needleIndex;

          // If moving "to", then move to a character before / after target character depending on
          // movement direction.
          if (state.semicolonCommaJumpType === 'to') {
            colIndex += (oppositeDirection === 'FORWARDS' ? -1 : 1);
          }

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            getIndexFromRowCol(text, state.row, colIndex),
          );
          state = resp.state;
          text = resp.text;
        }

        delete state.operation;
        delete state.last;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }

      case command === 'q':
        if (state.recordIntoRegister) {
          // Finish recording - remove the press to finish recording though
          state.registers[state.recordIntoRegister] = state.registers[state.recordIntoRegister].replace(/q$/, '');
          delete state.recordIntoRegister;
        } else {
          // Initial call
          state.last = 'set-recording-register';
        }
        break;

      case command === '@':
        state.last = 'set-playback-register';
        break;

      case command === 'c':
        if (state.operation === 'change') {
          for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
            let startIndex = getIndexOfStartOfRow(text, state.row);
            let endIndex = getIndexOfEndOfRow(text, state.row)-1;

            if (iteration === (state.operationIterations || 1)-1 /* last iteration */) {
              // Move forward the startindex to the first non-whitepsace character
              while (/^\s$/.test(text[startIndex])) { startIndex += 1; }

              // And move the cursor to the start of the change operation
              const {row, col} = getRowColFromIndex(text, startIndex);
              state.row = row;
              state.col = col;
            }

            // change line
            const resp = applyEditingOperation(
              text,
              state,
              startIndex,
              endIndex,
            );
            state = resp.state;
            text = resp.text;
          }

          delete state.operation;
          break;
        } else {
          state.operation = 'change';
        }
        break;
      case command === 'd':
        if (state.operation === 'delete') {
          for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
            const startIndex = getIndexOfStartOfRow(text, state.row);
            const endIndex = getIndexOfEndOfRow(text, state.row);

            // And move the cursor to the start of the change operation
            state.col = 0;

            // change line
            const resp = applyEditingOperation(text, state, startIndex, endIndex);
            state = resp.state;
            text = resp.text;
            pushHistoryState(state, text);
          }

          delete state.operation;
          break;
        } else {
          state.operation = 'delete';
        }
        break;
      case command === 'y':
        if (state.operation === 'yank') {
          const startIndex = getIndexOfStartOfRow(text, state.row);
          const endIndex = getIndexOfEndOfRow(text, state.row)-1;

          // And move the cursor to the start of the change operation
          const {row, col} = getRowColFromIndex(text, startIndex);
          state.row = row;
          state.col = col;

          // change line
          const resp = applyEditingOperation(text, state, startIndex, endIndex,);
          state = resp.state;
          text = resp.text;

          delete state.operation;
          break;
        } else {
          state.operation = 'yank';
        }
        break;
      case command === '"':
        state.last = 'set-register'
        break;

      case command === 'V':
        state.mode = 'visual line';
        state.visualStartIndex = getIndexFromRowCol(text, state.row, state.col);
        state.visualEndIndex = getIndexFromRowCol(text, state.row, state.col);
        break;
      case command === 'ctrl-v':
        state.mode = 'visual block';
        state.visualStartIndex = getIndexFromRowCol(text, state.row, state.col);
        state.visualEndIndex = getIndexFromRowCol(text, state.row, state.col);
        break;
      case command === 'v':
        state.mode = 'visual';
        state.visualStartIndex = getIndexFromRowCol(text, state.row, state.col);
        state.visualEndIndex = getIndexFromRowCol(text, state.row, state.col);
        break;

      case command === 'm':
        if (state.operation === 'delete') { // dm
          state.last = 'delete-mark';
        } else {
          state.last = 'set-mark';
        }
        delete state.operation;
        break;
      case command === "'":
        state.last = 'mark-movement';
        break;

      case command === 'p':
        pushHistoryState(state, text);
        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          text = text.slice(
            0, getIndexFromRowCol(text, state.row, state.col)
          ) + state.registers[state.register || '"'] + text.slice(getIndexFromRowCol(text, state.row, state.col));
        }

        delete state.operationIterations;
        break;

      case command === 'o': {
        pushHistoryState(state, text);

        // Figure out how many whitespace characters are at the start of the current row
        let startWhitespaceIndex = getIndexOfStartOfRow(text, state.row),
            endWhitespaceIndex = startWhitespaceIndex;
        while (/^\s$/.test(text[endWhitespaceIndex])) { endWhitespaceIndex += 1; }

        const whitespace = text.slice(startWhitespaceIndex, endWhitespaceIndex);

        // Create a new line after the current cursor position, and add whitespace to make even
        // with the previous line.
        const currentIndex = getIndexOfEndOfRow(text, state.row);
        text = text.slice(0, currentIndex) + '\n' + whitespace + text.slice(currentIndex);
        state.col = whitespace.length;
        state.row += 1;

        // Also go into insert mode
        state.mode = 'insert';
        state.insertAppend = true;
        state.registers["."] = '';
        break;
      }
      case command === 'O': {
        // Figure out how many whitespace characters are at the start of the current row
        let startWhitespaceIndex = getIndexOfStartOfRow(text, state.row),
            endWhitespaceIndex = startWhitespaceIndex;
        while (/^\s$/.test(text[endWhitespaceIndex])) { endWhitespaceIndex += 1; }

        const whitespace = text.slice(startWhitespaceIndex, endWhitespaceIndex);

        // Create a new line before the current cursor position, and add whitespace to make even
        // with the previous line.
        const currentIndex = getIndexOfStartOfRow(text, state.row);
        text = text.slice(0, currentIndex) + '\n' + whitespace + text.slice(currentIndex);
        state.col = whitespace.length;

        // Also go into insert mode
        state.mode = 'insert';
        state.insertAppend = true;
        state.registers["."] = '';
        break;
      }

      case command === 'w' || command === 'W': {
        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          const isUppercase = (command === 'W');

          let startingIndex = getIndexFromRowCol(text, state.row, state.col);
          while (/^\s$/.test(text[startingIndex])) { startingIndex += 1; }

          const textStartingAtIndex = text.slice(startingIndex);
          const words = findWords(textStartingAtIndex, isUppercase);

          let finalIndex;
          if (words.length > 1) {
            finalIndex = getIndexFromRowCol(text, state.row, state.col + words[1].index);
          } else {
            let index = words[0].index;
            finalIndex = getIndexFromRowCol(text, state.row, state.col + index - 1);
          }
     
          // HACK: if perfoming an edit operation, then `w` should apply until the end of the
          // current word, not until the next word like was done above
          if (words.length > 0 && state.operation) {
            finalIndex = getIndexFromRowCol(text, state.row, state.col + words[0].endIndex);
          }

          // When deleting, delete the whitespace afterwards
          if (state.operation === 'delete') { finalIndex += 1; }

          // shouldn't remove a newline at the end of the line, even if changing a word at the very
          // end of the line
          // ie:
          // foo bar baz
          //         ^
          //         cw
          if (text[finalIndex] === '\n') {
            finalIndex -= 1; /* remove newline from end */
          }

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            finalIndex,
          );
          state = resp.state;
          text = resp.text;
        }

        delete state.operation;
        delete state.last;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }

      case command === 'b' || command === 'B': {
        delete state.modifier;

        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          const isUppercase = (command === 'B');

          const currentIndex = getIndexFromRowCol(text, state.row, state.col);
          const startOfRowIndex = getIndexFromRowCol(text, 0, 0); // NOTE: we're loading the wole document in memory here, which is bad for big documents

          const textStartingAtIndex = text.slice(startOfRowIndex, currentIndex);
          const words = findWords(textStartingAtIndex, isUppercase);

          let finalIndex;
          if (words.length > 0) {
            finalIndex = getIndexFromRowCol(text, 0, words[words.length-1].index);
          } else {
            finalIndex = getIndexOfEndOfRow(text, state.row-1) || 0;
          }

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            finalIndex,
          );
          state = resp.state;
          text = resp.text;
        }

        delete state.operation;
        delete state.last;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }

      case command === 'e' || command === 'E': {
        delete state.modifier;

        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          const isUppercase = (command === 'E');
          const textStartingAtIndex = text.slice(getIndexFromRowCol(text, state.row, state.col) + 1);
          const words = findWords(textStartingAtIndex, isUppercase);

          let finalIndex;
          if (words.length > 0) {
            finalIndex = getIndexFromRowCol(text, state.row, state.col + words[0].endIndex) + 1;
          } else {
            finalIndex = getIndexOfEndOfRow(text, state.row) - 1;
          }
          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            finalIndex,
          );
          state = resp.state;
          text = resp.text;
        }

        delete state.operation;
        delete state.last;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }

      case command === 'j' || command === 'k': {
        delete state.modifier;
        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          let startIndex = getIndexFromRowCol(text, state.row, state.col);
          let endRow = command === 'j' ? state.row + 1 : state.row - 1;
          let endCol = state.col;

          const rows = text.split('\n');

          // Ensure within bounds
          if (endRow > rows.length-1) { break; }
          if (endRow < 0) { break; }

          // If moving from a longer line to a shorter line, then move the cursor to the end of the
          // line.
          if (endCol > rows[endRow].length-1) {
            endCol = rows[endRow].length - 1;
          }

          let endIndex = getIndexFromRowCol(text, endRow, endCol);

          if (state.operation) {
            startIndex = getIndexOfStartOfRow(text, Math.min(state.row, endRow));
            endIndex = getIndexOfEndOfRow(text, Math.max(state.row, endRow));
            if (state.operation === 'change') { endIndex -= 1; }
          }

          const resp = applyEditingOperation(text, state, startIndex, endIndex);
          state = resp.state;
          text = resp.text;

          if (state.operation) {
            if (state.operation === 'change') {
              text = text.slice(0, startIndex) + '\n' + text.slice(startIndex+1);
            }
            const { row, col } = getRowColFromIndex(endIndex);
            state.row = row;
            state.col = col;
          } else {
            state.row = endRow;
            state.col = endCol;
          }
        }

        delete state.operation;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }
      case command === 'h' || command === 'l': {
        delete state.modifier;
        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          let colIndex = command === 'l' ? state.col + 1 : state.col - 1;

          // If at a newline, skip back a character.
          if (text[getIndexFromRowCol(text, state.row, colIndex)] === '\n') {
            colIndex += command === 'l' ? 1 : -1;
          }

          if (state.col < 0) {
            state.col = 0;
            break;
          }

          const rows = text.split('\n');
          if (state.row === rows.length-1 && colIndex >= rows[state.row].length-1) {
            state.col = rows[state.row].length-1;
            break;
          }

          const resp = applyEditingOperation(
            text,
            state,
            getIndexFromRowCol(text, state.row, state.col),
            getIndexFromRowCol(text, state.row, colIndex),
          );
          state = resp.state;
          text = resp.text;
        }

        delete state.operation;
        delete state.last;
        delete state.operationIterations;
        delete state.modifier; // "inside" or "around" or undefined
        break;
      }

      case command === 'f' || command === 'F':
        delete state.modifier;
        state.last = 'find-char';
        state.searchDirection = command === 'f' ? 'FORWARDS' : 'BACKWARDS';
        break;

      case command === 't' || command === 'T':
        delete state.modifier;
        state.last = 'to-char';
        state.searchDirection = command === 't' ? 'FORWARDS' : 'BACKWARDS';
        break;

      case command === 'r':
        state.last = 'replace-char';
        break;

      case command === 'A':
        pushHistoryState(state, text);
        state.mode = 'insert';
        state.insertAppend = true;
      case command === 'C':
        if (state.mode !== 'insert') { state.operation = 'change'; }
      case command === 'D':
        if (state.operation !== 'change' && state.mode !== 'insert') { state.operation = 'delete'; }
      case command === '$': {
        delete state.modifier;
        const rows = text.split('\n');

        let endIndex = getIndexOfEndOfRow(text, state.row);

        if (state.mode !== 'insert') {
          endIndex -= 1;
        }

        const resp = applyEditingOperation(
          text,
          state,
          getIndexFromRowCol(text, state.row, state.col),
          endIndex,
        );
        state = resp.state;
        text = resp.text;

        delete state.operation;
        break;
      }
      
      case (command === '0' && typeof state.operationIterations !== 'number'): {
        const rows = text.split('\n');
        const colIndex = 0;

        const resp = applyEditingOperation(
          text,
          state,
          getIndexFromRowCol(text, state.row, state.col),
          getIndexFromRowCol(text, state.row, colIndex),
        );
        state = resp.state;
        text = resp.text;

        // Reset position after operation
        state.col = 0;
        break;
      }

      case command === 'I':
        pushHistoryState(state, text);
        state.mode = 'insert';
        state.insertAppend = true;
      case command === '^': {
        delete state.modifier;
        const rows = text.split('\n');

        // Find the first non-whitespace character
        let colIndex = getIndexOfStartOfRow(text, state.row);
        while (/^\s$/.test(text[colIndex])) { colIndex += 1; }

        const resp = applyEditingOperation(
          text,
          state,
          getIndexFromRowCol(text, state.row, state.col),
          colIndex,
        );
        state = resp.state;
        text = resp.text;
        break;
      }

      case command === 'u' || command === 'ctrl-r': {
        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          // Adjust the history index depending on the command
          if (command === 'u') { state.historyIndex -= 1; }
          if (command === 'ctrl-r') { state.historyIndex += 1; }

          // Ensure history index remains within bounds
          if (state.historyIndex < 0) { state.historyIndex = 0; }
          if (state.historyIndex > state.history.length-1) {
            state.historyIndex = state.history.length - 1;
          }
        }

        // Assign the state depending on the selected history state
        Object.assign(state, state.history[state.historyIndex].state);
        text = state.history[state.historyIndex].text;

        delete state.operationIterations;
        break;
      }

      // Repeat a movement more than once
      case (/^[0-9]$/).test(command): {
        const n = parseInt(command, 10);
        state.operationIterations = (10 * (state.operationIterations || 0)) + n;
        break;
      }

      case command === 'i':
        if (state.operation) {
          // "inside", like in `ciw`
          state.modifier = 'inside';
        } else {
          // Put the user into insert mode in a few ways (only if the user isn't in the middle of
          // another operation)
          pushHistoryState(state, text);
          state.mode = 'insert';
          state.insertAppend = true;
          state.registers["."] = '';
        }
        break;
      case command === 'a':
        if (state.operation) {
          // "around", like in `caw`
          state.modifier = 'around';
        } else {
          pushHistoryState(state, text);
          state.mode = 'insert';
          state.insertAppend = true;
          if (state.col > 0) {
            state.col += 1;
          }
          state.registers["."] = '';
        }
        break;

      // Delete the character under the cursor or before the cursor
      case command === 'x' || command === 'X':
        pushHistoryState(state, text);
        for (let iteration = 0; iteration < (state.operationIterations || 1); iteration++) {
          const startIndex = command === 'x' ? (
            getIndexFromRowCol(text, state.row, state.col) /* x */
          ) : (
            getIndexFromRowCol(text, state.row, state.col-1) /* X */
          );
          const endIndex = command === 'x' ? (
            getIndexFromRowCol(text, state.row, state.col+1) /* x */
          ) : (
            getIndexFromRowCol(text, state.row, state.col) /* X */
          );
          text = text.slice(0, startIndex) + text.slice(endIndex);

          if (command === 'X') { state.col -= 1; }
        }

        delete state.operationIterations;
        break;

      case command === ':':
        state.mode = 'command';
        state.commandQuery = '';
        state.commandCursorIndex = 0;
        break;

      case command === '?':
        state.searchDirection = 'BACKWARDS';
      case command === '/':
        delete state.modifier;
        state.searchDirection = state.searchDirection ? state.searchDirection : 'FORWARDS';
        state.mode = 'search';
        state.searchQuery = '';
        state.searchCursorIndex = 0;
        break;
    }
  });

  return {text, state};
}
