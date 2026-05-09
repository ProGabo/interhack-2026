import numpy as np
import random
import math

class SmartTruckOptimizer3D:
    def __init__(self, length_bays, width_pallets, height_layers, route):
        """
        length_bays: Number of lateral bays (X-axis)
        width_pallets: Depth of each bay (Y-axis). 
        height_layers: Maximum stacking height (Z-axis).
        route: List of client IDs in strict delivery order, e.g., [1, 2, 3]
        """
        self.L = length_bays
        self.W = width_pallets
        self.H = height_layers
        self.route = route
        
    def generate_initial_state(self, client_item_counts):
        """
        Randomly scatters items across the 3D grid. 
        Note: This initial state will have "floating" pallets, 
        which the optimizer will resolve as it cools.
        """
        state = np.zeros((self.L, self.W, self.H), dtype=int)
        flat_items = []
        for client, count in client_item_counts.items():
            flat_items.extend([client] * count)
            
        # Pad with empty spaces (0)
        flat_items.extend([0] * (self.L * self.W * self.H - len(flat_items)))
        np.random.shuffle(flat_items)
        return np.array(flat_items).reshape((self.L, self.W, self.H))

    def physical_penalty(self, state):
        """
        P(σ): Evaluates the 3D causal constraints.
        Returns the sum of topological trapping and anti-gravity violations.
        """
        penalty = 0
        truck = np.copy(state)

        # 1. Gravity Check (Static constraint)
        # Any pallet at z > 0 must have a pallet directly below it.
        for x in range(self.L):
            for y in range(self.W):
                for z in range(1, self.H):
                    if truck[x, y, z] != 0 and truck[x, y, z-1] == 0:
                        penalty += 1 # Floating pallet violation

        # 2. Topological Extraction Check (Dynamic causal constraint)
        for client in self.route:
            items_to_unload = np.argwhere(truck == client)

            for (x, y, z) in items_to_unload:
                # Vertical Clearance: Is there a pallet belonging to a future client on top?
                vertically_blocked = False
                if z < self.H - 1 and truck[x, y, z + 1] != 0 and truck[x, y, z + 1] != client:
                    vertically_blocked = True

                # Lateral Clearance: Is the path to the side tarps clear at this Z-level?
                left_blocked = False
                for col in range(0, y):
                    if truck[x, col, z] != 0 and truck[x, col, z] != client:
                        left_blocked = True
                        break

                right_blocked = False
                for col in range(y + 1, self.W):
                    if truck[x, col, z] != 0 and truck[x, col, z] != client:
                        right_blocked = True
                        break

                # Violation occurs if it cannot be lifted OR pulled out sideways
                if vertically_blocked or (left_blocked and right_blocked):
                    penalty += 1 

            # Remove client's items sequentially to evaluate deeper layers for future clients
            for (x, y, z) in items_to_unload:
                truck[x, y, z] = 0

        return penalty

    def spatial_work(self, state):
        """
        W(σ): The logistical effort metric. 
        Penalizes spreading a single client's pallets across the length of the truck.
        """
        work = 0
        for client in self.route:
            items = np.argwhere(state == client)
            if len(items) > 1:
                x_coords = items[:, 0]
                work += np.var(x_coords) # Driver walking distance
        return work

    def optimize(self, initial_state, steps=40000):
        """
        MCMC / Simulated Annealing with 3D tunneling.
        """
        current_state = np.copy(initial_state)
        current_P = self.physical_penalty(current_state)
        current_W = self.spatial_work(current_state)

        # Optimization Parameters (Increased steps and temps for 3D volume)
        T_0 = 150.0     
        T_min = 0.01    
        
        gamma_0 = 0.1   # Highly permissive to start
        gamma_max = 800 # Crushing penalty to finalize structure

        best_state = np.copy(current_state)
        best_H = float('inf')

        for step in range(steps):
            fraction = step / float(steps)
            T = T_0 * ((T_min / T_0) ** fraction) 
            gamma = gamma_0 + (gamma_max - gamma_0) * (fraction ** 4) # Steeper curve for 3D

            # Propose a 3D coordinate swap
            x1, y1, z1 = random.randint(0, self.L - 1), random.randint(0, self.W - 1), random.randint(0, self.H - 1)
            x2, y2, z2 = random.randint(0, self.L - 1), random.randint(0, self.W - 1), random.randint(0, self.H - 1)
            
            proposed_state = np.copy(current_state)
            proposed_state[x1, y1, z1], proposed_state[x2, y2, z2] = proposed_state[x2, y2, z2], proposed_state[x1, y1, z1]

            proposed_P = self.physical_penalty(proposed_state)
            proposed_W = self.spatial_work(proposed_state)
            
            current_H = current_W + (gamma * current_P)
            proposed_H = proposed_W + (gamma * proposed_P)
            
            delta_H = proposed_H - current_H

            # Metropolis Acceptance
            if delta_H < 0 or random.random() < math.exp(-delta_H / T):
                current_state = proposed_state
                current_P = proposed_P
                current_W = proposed_W

                # Save best state that is physically possible in the real world
                if current_P == 0 and current_H < best_H:
                    best_state = np.copy(current_state)
                    best_H = current_H

        return best_state, self.physical_penalty(best_state), self.spatial_work(best_state)

# --- EXECUTION ---
if __name__ == "__main__":
    # 8 bays long, 4 pallets wide, 3 pallets high
    optimizer = SmartTruckOptimizer3D(length_bays=8, width_pallets=4, height_layers=3, route=[1, 2, 3])
    
    # Client orders (Total volume = 8*4*3 = 96 spaces)
    orders = {
        1: 20, 
        2: 30, 
        3: 25  
    }
    
    initial = optimizer.generate_initial_state(orders)
    print("Initial 3D Penalty (Floating + Blocked):", optimizer.physical_penalty(initial))
    
    final_state, final_P, final_W = optimizer.optimize(initial)
    
    print(f"\nOptimization Complete.")
    print(f"Final Physical Violations: {final_P}")
    print(f"Final Work Metric: {final_W:.2f}")
    
    if final_P == 0:
        print("\nValid 3D Lattice Layout generated successfully.")
    else:
        print("\nOptimizer trapped in local minimum. Try increasing 'steps'.")