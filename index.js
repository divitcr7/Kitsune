// The app's entry. Background work is defined here, before the router, so Android can run it even
// when it starts Kitsune without showing it: the new-episode check and the downloads service task.
import './src/lib/notify';
import './src/lib/downloads/background';
import 'expo-router/entry';
