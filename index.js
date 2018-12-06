const bodyParser = require('body-parser')
const express = require('express')
const logger = require('morgan')
const app = express()
const {
  fallbackHandler,
  notFoundHandler,
  genericErrorHandler,
  poweredByHandler
} = require('./handlers.js')

// Libraries
var PF = require('pathfinding');
const util = require('util');

// Util fns
const getMovement = (moveHori, moveVerti) => {
  const movementDirections = [
    [undefined, 'down', undefined], // -1 vert
    ['right', undefined, 'left'], // 0 vert
    [undefined, 'up', undefined], // 1 vert
  ];

  return movementDirections[moveVerti + 1][moveHori + 1];
}
const log = (obj) => console.log(util.inspect(obj, {showHidden: false, depth: null}));
const getCoordsFromArray = (array) => array ? ({ x: array[0], y: array[1] }) : [];

// For deployment to Heroku, the port needs to be set using ENV, so
// we check for the port number in process.env
app.set('port', (process.env.PORT || 9001))

app.enable('verbose errors')

app.use(logger('dev'))
app.use(bodyParser.json())
app.use(poweredByHandler)

// --- SNAKE LOGIC GOES BELOW THIS LINE ---

class Game {
  constructor() {
    this.finder = new PF.AStarFinder();
    this.targetX = 0;
    this.targetY = 0;
  }

  setGrid(width, height) {
    this.grid = new PF.Grid(width, height);
    return this.grid;
  }

  setUnwalkable(x, y) {
    this.grid.setWalkableAt(x, y, false);
  }

  findPath(startX, startY, goalX, goalY) {
    const gridClone = this.grid.clone();
    return this.finder.findPath(startX, startY, goalX, goalY, gridClone);
  }

  setTarget(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  getTarget() {
    return { x: this.targetX,  y: this.targetY };
  }

  setPath(path) {
    this.path = path;
  }

  getPath() {
    return this.path;
  }

  isNextPathPoint() {
    return this.path ? this.path.length > 0 : false;
  }

  getNextPathPoint() {
    return this.path ? this.path.shift() : undefined;
  }
}

let game;

/**
 * Returns true or false if the (x,y) coord given exists
 */
const validFoodTarget = (x, y, food) => {
  const validTargets = food.filter(point => point.x === x && point.y === y);
  return validTargets.length > 0;
}

const validPathToFood = (startX, startY, foodX, foodY, game) => {
  return game.findPath(startX, startY, foodX, foodY).length > 0;
}

const calculateFurthestFoodPath = (headX, headY, food) => {
  // Return a full array of paths to all food
  const allPathsToFood = food.map(f => {
    const { x, y } = f;
    return game.findPath(headX, headY, x, y);
  });

  // Sort the arrays by path length and filter out any empty paths (i.e. foods that have no valid path)
  const pathsToFood = allPathsToFood.filter(path => path.length > 0).sort((a, b) => a.length > b.length);

  // Find the next path (when there is no available path it will do nothing)
  // TODO: Don't always go for the same thing - change behavior
  return pathsToFood.length > 0 ? pathsToFood[pathsToFood.length - 1].slice(1) : [[headX,headY]];
}

const calculateNearestFoodPath = (headX, headY, food) => {
  // Return a full array of paths to all food
  const allPathsToFood = food.map(f => {
    const { x, y } = f;
    return game.findPath(headX, headY, x, y);
  });

  // Sort the arrays by path length and filter out any empty paths (i.e. foods that have no valid path)
  const pathsToFood = allPathsToFood.filter(path => path.length > 0).sort((a, b) => a.length > b.length);

  // Find the next path (when there is no available path it will do nothing)
  return pathsToFood.length > 0 ? pathsToFood[0].slice(1) : [[headX,headY]];
}

const calculateNextPathToTarget = (startX, startY, endX, endY) => {
  const path = game.findPath(startX, startY, endX, endY).slice(1);
  return path.length > 0 ? path : [ [startX, startY] ];
}

// Handle POST request to '/start'
app.post('/start', (request, response) => {
  game = new Game();

  // Response data
  const data = {
    color: '#B20637',
  }

  return response.json(data)
});

// Handle POST request to '/move'
app.post('/move', (request, response) => {
  let move = 'up';

  // Game stats
  const { board: { width, height, snakes, food }, turn, you: me} = request.body;
  const { body: myBody } = me;
  const head = myBody[0];
  const tail = myBody[myBody.length - 1];
  const { x: headX, y: headY } = head;
  const { x: tailX, y: tailY } = tail;
  const { health } = me;

  // Setup game (if not already)
  const board = game.setGrid(width, height);

  // Set unmove-able areas.
  snakes.map(snake => {
    snake.body.map(part => {
      const {x, y} = part;
      game.setUnwalkable(x, y);
    })
  });

  let myTarget = game.getTarget();

  if( turn > 3 && health >= 25 && health < 60) {
    // If my target has expired, find a new one
    if (!validFoodTarget(myTarget.x, myTarget.y, food) || !validPathToFood(headX, headY, myTarget.x, myTarget.y, game)) {
      const nextPath = calculateFurthestFoodPath(headX, headY, food);
      const lastNode = getCoordsFromArray(nextPath[nextPath.length - 1]);
      game.setTarget(lastNode.x, lastNode.y);

      // Start tracking the new target
      myTarget = lastNode;
    }
  }
  // HUNGRY!! Find food QUICK
  else if ( turn > 3 && health < 25) {
    const nextPath = calculateNearestFoodPath(headX, headY, food);
    const lastNode = getCoordsFromArray(nextPath[nextPath.length - 1]);
    game.setTarget(lastNode.x, lastNode.y);

    // Start tracking the new target
    myTarget = lastNode;
  }
  // Let's hang around in the furthest away corner.
  else {
    const allPaths = [
      [0, 0 ],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ].map(point => {
      const p = getCoordsFromArray(point);
      return calculateNextPathToTarget(headX, headY, p.x, p.y).slice(1);
    }).filter(path => path.length > 0).sort((a, b) => a.length < b.length);
    const nextPath = allPaths.length > 0 ? allPaths[0] : [[headX,headY]];
    const lastNode = getCoordsFromArray(nextPath[nextPath.length - 1]);
    game.setTarget(lastNode.x, lastNode.y);

    // Start tracking the new target
    myTarget = lastNode;
  }

  const nextPath = calculateNextPathToTarget(headX, headY, myTarget.x, myTarget.y);
  game.setPath(nextPath);

  // Calculate next path point and move direction
  const next = game.getNextPathPoint();
  const nextPathPoint = getCoordsFromArray(next);
  const nextPoint = { x: nextPathPoint.x, y: nextPathPoint.y };
  const moveHorizontal = headX - nextPoint.x;
  const moveVertical = headY - nextPoint.y;

  move = getMovement(moveHorizontal, moveVertical);

  // Response data
  const data = {
    move
  }

  return response.json(data)
})

app.post('/end', (request, response) => {
  const data = {
    msg: 'DARN IT'
  };

  return response.json(data);
})

app.post('/ping', (request, response) => {
  const data = {
    msg: 'hey'
  };

  return response.json(data);
})

// --- SNAKE LOGIC GOES ABOVE THIS LINE ---

app.use('*', fallbackHandler)
app.use(notFoundHandler)
app.use(genericErrorHandler)

app.listen(app.get('port'), () => {
  console.log('Server listening on port %s', app.get('port'))
})
