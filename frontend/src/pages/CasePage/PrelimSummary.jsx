import {Box, Typography} from '@mui/material'
import StudentHeader from '../../components/StudentHeader';


const PrelimSummary = () => (
  <>
  <StudentHeader />
    <Box display="flex">
      <Typography variant="h6" gutterBottom sx={{ textAlign: 'left' }}>
            Preliminary Summary
      </Typography>
      {/* Your Case Overview Content here */}
    </Box>
    </>
  );

  
export default PrelimSummary