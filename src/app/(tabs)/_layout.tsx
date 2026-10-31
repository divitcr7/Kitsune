import { TabList, Tabs, TabSlot, TabTrigger } from 'expo-router/ui';
import { StyleSheet } from 'react-native';
import { NavBar } from '@/components/NavBar';
import { TabBarProvider } from '@/components/TabBarContext';
import { TvNav } from '@/components/TvNav';
import { isTV } from '@/lib/tv';
import { useUi } from '@/lib/ui';

export default function TabsLayout() {
  const fire = useUi((s) => s.fire);
  const Nav = isTV ? TvNav : NavBar;
  return (
    <TabBarProvider>
      <Tabs style={styles.fill}>
        <TabSlot style={styles.fill} />
        <Nav onReselect={(name) => fire(`reselect:${name}`)} />
        <TabList style={styles.hidden}>
          <TabTrigger name="home" href="/" />
          <TabTrigger name="discover" href="/discover" />
          <TabTrigger name="schedule" href="/schedule" />
          <TabTrigger name="library" href="/library" />
        </TabList>
      </Tabs>
    </TabBarProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: 'none' },
});
