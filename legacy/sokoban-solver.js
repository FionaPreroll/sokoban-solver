/**
 * Copyright spezifisch <spezifisch+git@gmail.com>
 * SPDX-License-Identifier: GPL-3.0-only
 */

// Initial setup
let _baseMap = [
    "____xxxx",
    "__xxx__x",
    "xxx_p__x",
    "xo__bx_x",
    "xoob_b_x",
    "xxxo_b_x",
    "__xxx__x",
    "____xxxx"
];

const defaultSolutionSteps = [
    "Down", "Left", "Left", "Down", "Left", "Up", "Right", "Right", "Right",
    "Down", "Left", "Left", "Up", "Right", "Up", "Right", "Right", "Right",
    "Down", "Down", "Left", "Left", "Right", "Right", "Down", "Down", "Left",
    "Up", "Right", "Up", "Up", "Up", "Left", "Left", "Down", "Down", "Left",
    "Down", "Right", "Up", "Up", "Up", "Right", "Right", "Down", "Down",
    "Left", "Left", "Down", "Left", "Up", "Right", "Right", "Right", "Down",
    "Left", "Left", "Up", "Up", "Left", "Left"
];
let solutionSteps = [...defaultSolutionSteps];

const canvas = document.getElementById("sokobanCanvas");
const ctx = canvas.getContext("2d");
const cellSize = 40;
const colors = {
    "x": "black", // Wall
    "_": "white", // Empty space
    "p": "blue", // Player
    "b": "brown", // Box
    "o": "green" // Target
};

let currentGrid = [..._baseMap];
let stepIndex = 0;
let intervalId;
let isPlaying = false;
let showBFSVisualization = false;
let showPlayer = true;

let currentBFSSearchId;

const _DIRECTIONS = {
    "Up": {
        dy: -1,
        dx: 0
    },
    "Down": {
        dy: 1,
        dx: 0
    },
    "Left": {
        dy: 0,
        dx: -1
    },
    "Right": {
        dx: 1,
        dy: 0
    }
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function _updateBaseMap(newBaseMap) {
    _baseMap = [...newBaseMap];
}

let _solver;

function _resetSolver() {
    _solver.updateGridState(_baseMap);
}

function _setSolverInProgress(newState) {
    _solver.inProgress = newState;
}

function _findPlayer(grid) {
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            if (grid[y][x] === "p") {
                return {
                    y,
                    x
                };
            }
        }
    }
    return null;
}

function _movePlayer(grid, direction) {
    const playerPos = _findPlayer(grid);
    if (!playerPos) {
        console.error("Error: Player position not found in the grid.");
        return grid;
    }
    const {
        dy,
        dx
    } = _DIRECTIONS[direction];
    const ny = playerPos.y + dy;
    const nx = playerPos.x + dx;

    // Check if the move is out of bounds
    if (ny < 0 || ny >= grid.length || nx < 0 || nx >= grid[0].length) {
        const msg = `Invalid move: Player cannot move out of bounds to (y${ny}, x${nx}). Tip: Ensure map is enclosed by walls.`;
        console.error(msg);
        throw new Error(msg);
    }

    if (grid[ny][nx] === "x") {
        return grid; // Hit a wall
    }

    let newGrid = grid.map(row => row.split(""));

    if (grid[ny][nx] === "b") {
        const nny = ny + dy;
        const nnx = nx + dx;

        // Check if the move including the boxes movement is out of bounds
        if (nny < 0 || nny >= grid.length || nnx < 0 || nnx >= grid[0].length) {
            const msg = `Invalid move: Box cannot move out of bounds to (y${ny}, x${nx}). Tip: Ensure map is enclosed by walls.`;
            console.error(msg);
            throw new Error(msg);
        }

        if (grid[nny][nnx] === "x" || grid[nny][nnx] === "b") {
            return grid; // Can't push the box
        }

        // Move the box
        newGrid[playerPos.y][playerPos.x] = _baseMap[playerPos.y][playerPos.x] === "o" ? "o" : "_";
        newGrid[ny][nx] = "p";
        newGrid[nny][nnx] = "b";
    } else {
        // Just move the player
        newGrid[playerPos.y][playerPos.x] = _baseMap[playerPos.y][playerPos.x] === "o" ? "o" : "_";
        newGrid[ny][nx] = "p";
    }

    return newGrid.map(row => row.join(""));
}

function renderGrid(grid, solutionSteps = []) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            const cell = grid[y][x];
            ctx.fillStyle = colors[cell] || "white";
            ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);

            if (cell === "p" && showPlayer) {
                ctx.beginPath();
                ctx.arc(x * cellSize + cellSize / 2, y * cellSize + cellSize / 2, cellSize / 3, 0, 2 * Math.PI);
                ctx.fillStyle = "blue";
                ctx.fill();
            } else if (cell === "b") {
                ctx.fillStyle = "brown";
                ctx.fillRect(x * cellSize + 5, y * cellSize + 5, cellSize - 10, cellSize - 10);
            } else if (cell === "o") {
                ctx.beginPath();
                ctx.arc(x * cellSize + cellSize / 2, y * cellSize + cellSize / 2, cellSize / 4, 0, 2 * Math.PI);
                ctx.fillStyle = "green";
                ctx.fill();
            }
        }
    }

    if (showBFSVisualization) {
        // Draw arrows to represent solution steps
        let tempGrid = [...grid];
        for (let i = 0; i < solutionSteps.length; i++) {
            const direction = solutionSteps[i];
            const {
                x,
                y
            } = _findPlayer(tempGrid);
            const {
                dx,
                dy
            } = _DIRECTIONS[direction];
            ctx.beginPath();
            ctx.moveTo(x * cellSize + cellSize / 2, y * cellSize + cellSize / 2);
            ctx.lineTo((x + dx) * cellSize + cellSize / 2, (y + dy) * cellSize + cellSize / 2);
            ctx.strokeStyle = "red";
            ctx.lineWidth = 3;
            ctx.stroke();
            tempGrid = _movePlayer(tempGrid, direction); // Simulate the move to get the new player position
        }
    }
}

//
//
//
//
// Animation

// Reset the stepIndex when starting the animation
// Start or resume animation
function startAnimation() {
    if (!isPlaying) {
        isPlaying = true;

        intervalId = setInterval(() => {
            console.log("Current step:", stepIndex); // Debugging stepIndex
            if (stepIndex < solutionSteps.length) {
                currentGrid = _movePlayer(currentGrid, solutionSteps[stepIndex]);
                renderGrid(currentGrid, solutionSteps);
                stepIndex++;
            } else {
                clearInterval(intervalId);
                isPlaying = false; // Stop the animation
                document.getElementById("startAnimation").innerText = "Play"; // Reset button text
            }
        }, 100);

    } else {
        clearInterval(intervalId);
        isPlaying = false;
        document.getElementById("startAnimation").innerText = "Resume";
    }
}

// Event Listener for the Play/Resume/Pause button
document.getElementById("startAnimation").addEventListener("click", function() {
    if (!isPlaying) {
        startAnimation();
        this.innerText = "Pause"; // Change button text to "Pause"
    } else {
        clearInterval(intervalId);
        isPlaying = false;
        this.innerText = "Resume"; // Change button text to "Resume"
    }
});

// Function to stop and reset the animation
function stopAndResetAnimation() {
    clearInterval(intervalId);
    isPlaying = false;
    stepIndex = 0;
    currentGrid = [..._baseMap]; // Reset grid to initial state
    renderGrid(currentGrid, solutionSteps); // Re-render the grid
    document.getElementById("startAnimation").innerText = "Play"; // Reset button text
}

document.getElementById("resetAnimation").addEventListener("click", stopAndResetAnimation);

// Function to advance one step in the animation
function nextStep() {
    if (stepIndex < solutionSteps.length) {
        currentGrid = _movePlayer(currentGrid, solutionSteps[stepIndex]);
        renderGrid(currentGrid, solutionSteps);
        stepIndex++;

        // If we reach the end of the solution steps
        if (stepIndex >= solutionSteps.length) {
            document.getElementById("startAnimation").innerText = "Play"; // Reset button text
            document.getElementById("stopAnimation").style.display = "none"; // Hide stop button
            isPlaying = false;
        }
    }
}

// Event Listener for the Next Step button
document.getElementById("nextStep").addEventListener("click", nextStep);

//
//
//
// Solver 1: BFS
class SokobanSolver {
    constructor(initialGrid) {
        this.initialGrid = initialGrid.map(row => row.slice()); // Deep copy of the initial grid
        this.currentGrid = initialGrid.map(row => row.slice()); // Another deep copy to track current state
        this.solutionSteps = [];
        this.playerPos = this.findPlayer(this.currentGrid);
        this.visitedStates = 0; // Track number of visited states
        this.totalStates = 0; // Estimate total states
        this.inProgress = false; // Track if BFS is in progress
        this.shouldStop = false; // Track if BFS should stop
    }

    findPlayer(grid) {
        return _findPlayer(grid);
    }

    movePlayer(grid, direction) {
        return _movePlayer(grid, direction);
    }

    isGoalState(grid) {
        for (let y = 0; y < grid.length; y++) {
            for (let x = 0; x < grid[y].length; x++) {
                if (grid[y][x] === "b" && this.initialGrid[y][x] !== "o") {
                    return false; // A box is not on a target
                }
            }
        }
        return true;
    }

    updateGridState(newGrid) {
        this.currentGrid = newGrid.map(row => row.slice()); // Update the internal grid state
        this.playerPos = this.findPlayer(this.currentGrid); // Update the player position
    }
    async bfs(searchId, debug = false) {
        this.inProgress = true;
        this.shouldStop = false; // Reset stop flag
        const queue = [{
            grid: this.currentGrid.map(row => row.slice()), // Use the current state
            path: [],
            playerPos: this.playerPos
        }];
        const visited = new Set();
        this.totalStates = 0;
        this.visitedStates = 0;

        while (queue.length > 0) {
            const {
                grid,
                path,
                playerPos
            } = queue.shift();

            if (debug) {
                console.log(`Processing state ${this.visitedStates + 1}, Queue length: ${queue.length}`);
            }

            // Check if the search has been canceled
            if (this.shouldStop) {
                if (debug) {
                    console.log(`BFS search ${searchId} canceled.`);
                }
                this.inProgress = false;
                return [];
            }

            const gridString = grid.join(""); // Join rows into a single string for consistent comparison

            if (visited.has(gridString)) {
                if (debug) {
                    console.log("State already visited, skipping.");
                }
                continue;
            }
            visited.add(gridString);
            this.visitedStates++;

            // Introduce a short delay every 100 visited states
            if (this.visitedStates % 100 === 0) {
                if (debug) {
                    console.log(`${this.visitedStates} states visited.`);
                }
                await delay(0); // Yield for the main thread to update progress text
            }

            if (this.isGoalState(grid)) {
                if (debug) {
                    console.log("Goal state found.");
                }
                this.solutionSteps = path;
                this.inProgress = false;
                return path;
            }

            try {
                // Attempt to move in each direction
                const directions = ["Up", "Right", "Down", "Left"];
                for (const direction of directions) {
                    const newGrid = this.movePlayer(grid, direction); // Directly pass the grid
                    const newPlayerPos = this.findPlayer(newGrid);

                    if (newPlayerPos && !visited.has(newGrid.join(""))) {
                        queue.push({
                            grid: newGrid.map(row => row.slice()), // Keep it as an array of strings
                            path: [...path, direction],
                            playerPos: newPlayerPos
                        });
                    } else if (debug) {
                        console.log("Invalid or previously visited state, not adding to queue.");
                    }
                }
            } catch (error) {
                console.error(error.message);
                this.inProgress = false;
                alert(error.message);
                return []; // Stop BFS if an invalid move occurs
            }
        }

        if (debug) {
            console.log("BFS completed, no solution found.");
        }
        this.inProgress = false;
        return []; // No solution found
    }


    static get DIRECTIONS() {
        return _DIRECTIONS;
    }

    stop() {
        this.shouldStop = true;
    }
}

function _updateBFSText(steps) {
    if (steps === -1) {
        document.getElementById("bfsText").innerText = "Solving...";
    } else if (steps === 0) {
        document.getElementById("bfsText").innerText = "No solution found.";
    } else {
        document.getElementById("bfsText").innerText = steps + " steps";
    }
}

// Function to update BFS text with progress
function _updateBFSProgress() {
    if (_solver.inProgress) {
        const progressText = `${_solver.visitedStates} states visited...`;
        document.getElementById("bfsText").innerText = progressText;
        requestAnimationFrame(() => _updateBFSProgress());
    }
}

// Event Listener for the "Stop Solving" button
document.getElementById("stopSolving").addEventListener("click", function() {
    _solver.stop(); // Set the stop flag
    document.getElementById("stopSolving").style.display = "none"; // Hide the stop button
    _updateBFSText(0); // Update the text to indicate the solving was stopped
});

async function calculatePathHandler(debug = false) {
    // Start a new BFS search
    const searchId = Date.now(); // Use timestamp as a unique identifier
    currentBFSSearchId = searchId;

    console.log("Calculating Path using BFS.");
    _updateBFSText(-1); // Display "Solving...
    document.getElementById("stopSolving").style.display = "inline"; // Show the stop button

    _resetSolver();
    _solver.inProgress = true;
    _updateBFSProgress(); // Start progress update loop
    const debugBFS = debug;
    solutionSteps = await _solver.bfs(currentBFSSearchId, debugBFS);

    // solved! if it's possible'
    _updateBFSText(solutionSteps.length);
    document.getElementById("stopSolving").style.display = "none"; // Hide the stop button after completion
    stopAndResetAnimation();
}

// Event Listener for the Calculate Path button
document.getElementById("calculatePath").addEventListener("click", async () => await calculatePathHandler(false));
document.getElementById("calculatePathDebug").addEventListener("click", async () => await calculatePathHandler(true));

//
//
//
//
// Map Editor
class MapEditor {
    constructor(canvas, grid, renderCallback) {
        this.canvas = canvas;
        this.grid = grid;
        this.renderCallback = renderCallback; // Function to call when the grid is updated
        this.isEditMode = false;
        this.selectedColor = null;
        this.editorColors = {
            "x": "black",
            "_": "white",
            "p": "blue",
            "b": "brown",
            "o": "green"
        };

        this.initializeColorSelectors();
        this.addCanvasClickListener();
        this.addExitEditModeListener();
    }

    initializeColorSelectors() {
        const colorSelectorsDiv = document.getElementById("colorSelectors");
        colorSelectorsDiv.innerHTML = ""; // Clear existing buttons if any
        for (const [key, color] of Object.entries(this.editorColors)) {
            const button = document.createElement("button");
            button.style.backgroundColor = color;
            button.dataset.mapElement = key; // Store the map element in the button
            button.style.width = "40px";
            button.style.height = "40px";
            button.addEventListener("click", () => this.selectColor(key));
            colorSelectorsDiv.appendChild(button);
        }
    }

    selectColor(colorKey) {
        this.selectedColor = colorKey;
        document.body.style.cursor = "crosshair"; // Change cursor to painting tool shape
        document.getElementById("exitEditMode").style.backgroundColor = "red"; // Enable exit button
        this.isEditMode = true;
    }

    addExitEditModeListener() {
        document.getElementById("exitEditMode").addEventListener("click", () => {
            this.isEditMode = false;
            this.selectedColor = null;
            document.body.style.cursor = "default";
            document.getElementById("exitEditMode").style.backgroundColor = "grey"; // Disable exit button
        });
    }

    addCanvasClickListener() {
        this.canvas.addEventListener("click", (event) => {
            if (this.isEditMode && this.selectedColor) {
                const rect = this.canvas.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;

                const gridX = Math.floor(x / cellSize);
                const gridY = Math.floor(y / cellSize);

                if (gridX >= 0 && gridX < this.grid[0].length && gridY >= 0 && gridY < this.grid.length) {
                    // If placing the player, remove the previous player first
                    if (this.selectedColor === "p") {
                        this.removePlayer();
                    }

                    // Update the grid with the selected color
                    const newRow = this.grid[gridY].split("");
                    newRow[gridX] = this.selectedColor;
                    this.grid[gridY] = newRow.join("");

                    // update base map (initial state of level)
                    _updateBaseMap(this.grid);

                    // Re-render the grid
                    this.renderCallback(this.grid, solutionSteps);

                    // Update the BFS solver's grid state
                    _solver.updateGridState(this.grid);
                }
            }
        });
    }

    removePlayer() {
        for (let y = 0; y < this.grid.length; y++) {
            const row = this.grid[y].split("");
            const playerIndex = row.indexOf("p");
            if (playerIndex !== -1) {
                row[playerIndex] = "_"; // Set the old player position to empty space
                this.grid[y] = row.join("");
                break;
            }
        }
    }
}

const mapEditor = new MapEditor(canvas, currentGrid, renderGrid);

//
//
//
// Layers

// Set the checkboxes based on the initial values
document.getElementById("toggleBFSVisualization").checked = showBFSVisualization;
document.getElementById("togglePlayer").checked = showPlayer;
document.getElementById("togglePlayer").parentElement.style.visibility = "hidden"; // FIXME its bugged

// Event Listener
document.getElementById("toggleBFSVisualization").addEventListener("change", function() {
    showBFSVisualization = this.checked;
    renderGrid(currentGrid, solutionSteps);
});

document.getElementById("togglePlayer").addEventListener("change", function() {
    showPlayer = this.checked;
    renderGrid(currentGrid, solutionSteps);
});

// First Render
_solver = new SokobanSolver(_baseMap);
_resetSolver();
renderGrid(currentGrid, solutionSteps);
_updateBFSText(solutionSteps.length);

