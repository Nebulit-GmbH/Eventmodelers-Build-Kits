import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Arc } from '@cratis/arc.react';
import { DialogComponents } from '@cratis/arc.react/dialogs';
import { BusyIndicatorDialog, ConfirmationDialog } from '@cratis/components/Dialogs';
import { Home } from './Home';
import { SomeFeature } from './SomeModule/SomeFeature';

function App() {
    return (
        <Arc>
            <DialogComponents confirmation={ConfirmationDialog} busyIndicator={BusyIndicatorDialog}>
                <BrowserRouter>
                    <Routes>
                        <Route path='/' element={<Home />} />
                        <Route path='/demo' element={<SomeFeature />} />
                    </Routes>
                </BrowserRouter>
            </DialogComponents>
        </Arc>
    );
}

export default App;
