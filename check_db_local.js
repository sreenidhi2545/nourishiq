require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function checkSchema() {
  const { data, error } = await supabase.from('users').select('*').limit(1);
  if (error) {
    console.error('Error fetching users:', error.message);
  } else {
    console.log('Sample user data:', data);
    if (data && data[0]) {
       console.log('Columns found:', Object.keys(data[0]));
    }
  }
}

checkSchema();
