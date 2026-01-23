class Solution:
    def searchMatrix(self, matrix: List[List[int]], target: int) -> bool:
        # 2d binary search:
        # - search which row target might be in
        #   - if prev_row[0] <= target < next_row[0], target_row = prev_row
        # - then perform binary search within the row
        prev_row, next_row = 0, len(matrix) - 1
        while prev_row <= next_row:
            mid_row = prev_row + (next_row - prev_row) // 2
            if target < matrix[mid_row][0]:
                next_row = mid_row - 1
            elif target > matrix[mid_row][-1]:
                prev_row = mid_row + 1
            else:
                prev_row = mid_row
                break
        if prev_row > next_row:
            return False

        target_row = matrix[prev_row]
        left, right = 0, len(target_row) - 1
        while left <= right:
            mid = left + (right - left) // 2
            if target < target_row[mid]:  # target is on the left side
                right = mid - 1
            elif target > target_row[mid]:
                left = mid + 1
            else:
                return True

        return False


    def searchMatrixOnePass(self, matrix: List[List[int]], target: int) -> bool:
        # treat 2d array like a 1d array
        # find a way to calculate mid point
        # - 
        rows, cols = len(matrix), len(matrix[0])
        left, right = 0, rows*cols-1
        while left <= right:
            mid = left + (right - left) // 2
            mid_row = mid // cols
            mid_col = mid % cols
            if target < matrix[mid_row][mid_col]:
                # target is on the left side
                right = mid - 1
            elif target > matrix[mid_row][mid_col]:
                left = mid + 1
            else:
                return True
        return False

if __name__ == '__main__':
    test_cases = [
        ([[1,3,5,7],[10,11,16,20],[23,30,34,60]], 3, True),
        ( [[1, 3], [5, 7], [9, 11]], 4, False),
        ([[1,2,4,8],[10,11,12,13],[14,20,30,40]], 10, True),
        ([[1,2,4,8],[10,11,12,13],[14,20,30,40]], 15, False),
        ([[1]], 1, True),
        ([[1]], 2, False),
    ]
    s = Solution()
    for matrix, target, expected in test_cases:
        if (res := s.searchMatrixOnePass(matrix, target)) == expected:
            print("passed")
        else:
            print(f"res is {res}, expected is {expected}")
