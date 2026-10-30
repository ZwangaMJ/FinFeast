import { router, useLocalSearchParams } from 'expo-router';

import { DocumentFlow } from '@/components/DocumentFlow';
import { IconButton, Row, Screen } from '@/components/ui';

export default function Upload() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Screen edges={['top', 'bottom']}>
      <Row style={{ justifyContent: 'flex-end', marginBottom: 4 }}>
        <IconButton icon="close" label="Close" onPress={close} />
      </Row>
      <DocumentFlow mode={mode === 'receipt' ? 'receipt' : 'upload'} onDone={close} />
    </Screen>
  );
}
