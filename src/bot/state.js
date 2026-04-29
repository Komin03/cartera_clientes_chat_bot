const userState = new Map();

function getState(userId) {
  return userState.get(userId);
}

function setState(userId, state) {
  userState.set(userId, state);
}

function clearState(userId) {
  userState.delete(userId);
}

module.exports = {
  clearState,
  getState,
  setState,
};